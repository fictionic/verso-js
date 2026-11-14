import {describe, test, expect, vi, beforeEach} from 'vitest';

vi.mock('../core/common/tokenizeElements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/common/tokenizeElements')>();
  return {
    ...actual,
    tokenizeElements: vi.fn(),
  };
});

// mocked so that the tests do not need RLS
vi.mock('../core/common/abort', () => ({
  getAbortPromise: vi.fn(),
}));

import {TOKEN, tokenizeElements, type PageElementToken} from '../core/common/tokenizeElements';
import {Root} from '../core/common/components/Root';
import {PageElementProcessor, type ProcessorOpts} from '../core/common/PageElementProcessor';
import {getAbortPromise} from '../core/common/abort';
import {tick} from './util/promise';

const tokenizeElementsMock = vi.mocked(tokenizeElements);
const getAbortPromiseMock = vi.mocked(getAbortPromise);

function rootToken(when: Promise<unknown>): PageElementToken {
  return {
    type: TOKEN.ROOT,
    element: (<Root when={when as Promise<void>}><div /></Root>) as any,
  };
}
function containerOpenToken(): PageElementToken {
  return {type: TOKEN.CONTAINER_OPEN, element: {props: {}} as any};
}
function containerCloseToken(): PageElementToken {
  return {type: TOKEN.CONTAINER_CLOSE};
}
function foldToken(): PageElementToken {
  return {type: TOKEN.THE_FOLD};
}

beforeEach(() => {
  tokenizeElementsMock.mockReset();
  getAbortPromiseMock.mockReturnValue(new Promise<never>(() => {}));
});

function makeProcessor(opts: Partial<ProcessorOpts<string | null>> = {}) {
  return new PageElementProcessor<string | null>({
    renderContainerOpen: opts.renderContainerOpen ?? (() => null),
    renderContainerClose: opts.renderContainerClose ?? (() => null),
    // `i` is the token index, not the root index: in [CO, root, CC] the root is R1
    renderRootElement: opts.renderRootElement ?? ((i) => `R${i}`),
    onLastProcessedRootIndex: opts.onLastProcessedRootIndex ?? (() => {}),
    onProcessedTheFoldIndex: opts.onProcessedTheFoldIndex ?? (() => {}),
    consumeRenderedElements: opts.consumeRenderedElements ?? (() => {}),
  });
}

describe('PageElementProcessor', () => {
  test('single root: processes and consumes after resolution', async () => {
    const dfd = Promise.withResolvers<void>();
    tokenizeElementsMock.mockReturnValue([rootToken(dfd.promise)]);

    const consumed: string[] = [];
    const onLastProcessedRootIndex = vi.fn();
    const processor = makeProcessor({
      onLastProcessedRootIndex,
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) consumed.push(v);
      },
    });

    const done = processor.process([]);
    await tick();
    expect(consumed).toEqual([]);
    expect(onLastProcessedRootIndex).not.toHaveBeenCalled();

    dfd.resolve();
    await done;

    expect(consumed).toEqual(['R0']);
    expect(onLastProcessedRootIndex).toHaveBeenCalledTimes(1);
    expect(onLastProcessedRootIndex).toHaveBeenCalledWith(0);
  });

  test('roots resolving in order: each consumed progressively', async () => {
    const dfds = [0, 1, 2].map(() => Promise.withResolvers<void>());
    tokenizeElementsMock.mockReturnValue(dfds.map(({promise}) => rootToken(promise)));

    const consumed: string[] = [];
    const processor = makeProcessor({
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) consumed.push(v);
      },
    });

    const done = processor.process([]);

    dfds[0]!.resolve();
    await tick();
    expect(consumed).toEqual(['R0']);

    dfds[1]!.resolve();
    await tick();
    expect(consumed).toEqual(['R0', 'R1']);

    dfds[2]!.resolve();
    await done;
    expect(consumed).toEqual(['R0', 'R1', 'R2']);
  });

  test('out of order resolution: drain blocks on first PENDING', async () => {
    const d0 = Promise.withResolvers<void>();
    const d1 = Promise.withResolvers<void>();
    tokenizeElementsMock.mockReturnValue([
      rootToken(d0.promise),
      rootToken(d1.promise),
    ]);

    const consumed: string[] = [];
    const processor = makeProcessor({
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) consumed.push(v);
      },
    });

    const done = processor.process([]);

    d1.resolve();
    await tick();
    expect(consumed).toEqual([]);

    d0.resolve();
    await done;
    expect(consumed).toEqual(['R0', 'R1']);
  });

  test('containers and roots: consumed in document order', async () => {
    const d0 = Promise.withResolvers<void>();
    tokenizeElementsMock.mockReturnValue([
      containerOpenToken(),
      rootToken(d0.promise),
      containerCloseToken(),
    ]);

    const consumed: string[] = [];
    const processor = makeProcessor({
      renderContainerOpen: () => 'CO',
      renderContainerClose: () => 'CC',
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) consumed.push(v);
      },
    });

    const done = processor.process([]);

    d0.resolve();
    await done;

    expect(consumed).toEqual(['CO', 'R1', 'CC']);
  });

  test('fold callback is invoked with correct index', async () => {
    tokenizeElementsMock.mockReturnValue([
      containerOpenToken(),
      foldToken(),
    ]);

    const onProcessedTheFoldIndex = vi.fn().mockResolvedValue(undefined);
    const processor = makeProcessor({
      renderContainerOpen: () => 'CO',
      onProcessedTheFoldIndex,
    });

    await processor.process([]);
    expect(onProcessedTheFoldIndex).toHaveBeenCalledTimes(1);
    expect(onProcessedTheFoldIndex).toHaveBeenCalledWith(1);
  });

  test('onProcessedTheFoldIndex is called only once even when later roots resolve during its await', async () => {
    const d0 = Promise.withResolvers<void>();
    const d1 = Promise.withResolvers<void>();
    const foldDfd = Promise.withResolvers<void>();

    tokenizeElementsMock.mockReturnValue([
      foldToken(),
      rootToken(d0.promise),
      rootToken(d1.promise),
    ]);

    const onProcessedTheFoldIndex = vi.fn().mockReturnValue(foldDfd.promise);
    const processor = makeProcessor({
      onProcessedTheFoldIndex,
    });

    const done = processor.process([]);
    await tick();
    expect(onProcessedTheFoldIndex).toHaveBeenCalledTimes(1);

    d0.resolve();
    d1.resolve();
    await tick();

    foldDfd.resolve();
    await done;

    expect(onProcessedTheFoldIndex).toHaveBeenCalledTimes(1);
  });

  test('drain race regression: tokens consumed in document order even when later roots resolve during a fold await', async () => {
    // Regression guard: if the fold is marked PROCESSED before its await, or if
    // walk() is reentrant, the walks started by the root resolutions consume
    // the trailing tokens before 'CO'.
    const d0 = Promise.withResolvers<void>();
    const d1 = Promise.withResolvers<void>();
    const foldDfd = Promise.withResolvers<void>();

    tokenizeElementsMock.mockReturnValue([
      containerOpenToken(),
      foldToken(),
      rootToken(d0.promise),
      rootToken(d1.promise),
      containerCloseToken(),
    ]);

    const allConsumed: string[] = [];
    const processor = makeProcessor({
      renderContainerOpen: () => 'CO',
      renderContainerClose: () => 'CC',
      onProcessedTheFoldIndex: () => foldDfd.promise,
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) allConsumed.push(v);
      },
    });

    const done = processor.process([]);
    await tick();
    expect(allConsumed).toEqual(['CO']);

    d0.resolve();
    d1.resolve();
    await tick();
    expect(allConsumed).toEqual(['CO']);

    foldDfd.resolve();
    await done;
    expect(allConsumed).toEqual(['CO', 'R2', 'R3', 'CC']);
  });

  test('fold flushes above-fold roots before invoking onProcessedTheFoldIndex', async () => {
    // The server fold callback writes hydrateRootsUpTo. If it runs before the
    // above-fold root is consumed, the client tries to hydrate that root before
    // its DOM arrives. To get there, the below-fold root must resolve first.
    const dA = Promise.withResolvers<void>();
    const dB = Promise.withResolvers<void>();
    const foldDfd = Promise.withResolvers<void>();

    tokenizeElementsMock.mockReturnValue([
      rootToken(dA.promise),
      foldToken(),
      rootToken(dB.promise),
    ]);

    const events: string[] = [];
    const processor = makeProcessor({
      onProcessedTheFoldIndex: (i) => {
        events.push(`fold(${i}):start`);
        return foldDfd.promise.then(() => { events.push(`fold(${i}):end`); });
      },
      onLastProcessedRootIndex: (i) => { events.push(`onProcessRoot(${i})`); },
      consumeRenderedElements: (rendered) => {
        const labels = rendered.filter((v): v is string => v !== null);
        events.push(`consume(${labels.join(',')})`);
      },
    });

    const done = processor.process([]);

    dB.resolve();
    await tick();
    expect(events).toEqual([]);

    dA.resolve();
    await tick();

    expect(events).toEqual([
      'consume(R0)',
      'onProcessRoot(0)',
      'fold(1):start',
    ]);

    foldDfd.resolve();
    await done;

    expect(events).toEqual([
      'consume(R0)',
      'onProcessRoot(0)',
      'fold(1):start',
      'fold(1):end',
      'consume(R2)',
      'onProcessRoot(2)',
    ]);
  });

  test('abort: pending entries are skipped; rendered entries still flush', async () => {
    const d0 = Promise.withResolvers<void>();
    const d1 = Promise.withResolvers<void>();
    const d2 = Promise.withResolvers<void>();
    const abortDfd = Promise.withResolvers<never>();

    getAbortPromiseMock.mockReturnValue(abortDfd.promise);
    tokenizeElementsMock.mockReturnValue([
      rootToken(d0.promise),
      rootToken(d1.promise),
      rootToken(d2.promise),
    ]);

    const consumed: string[] = [];
    const processor = makeProcessor({
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) consumed.push(v);
      },
    });

    const done = processor.process([]);

    d1.resolve();
    await tick();
    expect(consumed).toEqual([]);

    abortDfd.reject(new Error('aborted'));
    await done;

    expect(consumed).toEqual(['R1']);
  });
});
