import React from 'react';
import { test, expect, describe, vi } from 'vitest';
import { Root, makeRootComponent } from '../core/components/Root';
import RootContainer from '../core/components/RootContainer';
import TheFold from '../core/components/TheFold';
import type { StandardizedPage } from '../core/handler/Page';

vi.mock('../core/components/RootContainer', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/components/RootContainer')>();
  return {
    ...original,
    renderContainerOpen: vi.fn((_element, index) => `<div data-container="${index}">`),
    renderContainerClose: vi.fn(() => `</div>`),
  };
});

// import handleBody after mocks are set up
const { writeBody } = await import('../server/writeBody');

function simplePage(elements: React.ReactElement[]): StandardizedPage {
  return {
    getRouteDirective() { return { status: 200 } },
    getElements() { return elements; },
    getTitle() { return 'Test'; },
    getSystemStylesheets() { return []; },
    getStylesheets() { return []; },
    getHeaders() { return []; },
    getSystemScripts() { return []; },
    getScripts() { return []; },
    getSystemLinkTags() { return []; },
    getLinkTags() { return []; },
  };
}

function run(page: StandardizedPage, opts?: { timeoutMs?: number }) {
  const chunks: string[] = [];
  const write = vi.fn((html: string) => chunks.push(html));
  const rootCalls: number[] = [];
  const onRoot = vi.fn((index: number) => rootCalls.push(index));
  const foldCalls: number[] = [];
  const onTheFold = vi.fn((index: number) => foldCalls.push(index));
  const ac = new AbortController();

  if (opts?.timeoutMs != null) {
    setTimeout(() => ac.abort(), opts.timeoutMs);
  }

  const done = writeBody(page, write, onRoot, onTheFold, ac.signal);
  return { chunks, write, rootCalls, onRoot, foldCalls, onTheFold, done, abort: () => ac.abort() };
}

describe('handleBody', () => {

  // --- basic rendering ---

  test('single root renders html and calls onRoot', async () => {
    const page = simplePage([
      <Root><div>Hello</div></Root>,
    ]);
    const { chunks, rootCalls, done } = run(page);
    await done;

    const html = chunks.join('');
    expect(html).toContain('Hello');
    expect(html).toContain('data-verso-root');
    expect(rootCalls).toHaveLength(1);
  });

  test('multiple roots render in document order', async () => {
    const page = simplePage([
      <Root><div>First</div></Root>,
      <Root><div>Second</div></Root>,
      <Root><div>Third</div></Root>,
    ]);
    const { chunks, done } = run(page);
    await done;

    const html = chunks.join('');
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'));
    expect(html.indexOf('Second')).toBeLessThan(html.indexOf('Third'));
  });

  test('later root resolving first does not break document order', async () => {
    let resolveFirst!: () => void;
    const slow = new Promise<null>(r => { resolveFirst = () => r(null); });

    const page = simplePage([
      <Root when={slow}><div>Slow</div></Root>,
      <Root><div>Fast</div></Root>,
    ]);
    const { chunks, done } = run(page);

    await new Promise(r => setTimeout(r, 10));
    resolveFirst();
    await done;

    const html = chunks.join('');
    expect(html.indexOf('Slow')).toBeLessThan(html.indexOf('Fast'));
  });

  // --- onRoot index correctness ---

  test('onRoot is called for each root as it flushes', async () => {
    // Every root goes through scheduleRender which returns a promise,
    // so each resolves in its own microtask and flushes separately.
    const page = simplePage([
      <Root><div>A</div></Root>,
      <Root><div>B</div></Root>,
    ]);
    const { rootCalls, done } = run(page);
    await done;

    expect(rootCalls).toEqual([0, 1]);
  });

  test('onRoot does not crash when the queue is fully consumed', async () => {
    // Single root, token index 0. After flushing, queue.next === queue.length.
    // queue.current() would read array[1] which is undefined.
    const page = simplePage([
      <Root><div>Only</div></Root>,
    ]);
    const { rootCalls, onRoot, done } = run(page);
    await done;

    // onRoot should have been called exactly once without throwing
    expect(onRoot).toHaveBeenCalledTimes(1);
    // and the index should be 0 (the only root's token index)
    expect(rootCalls[0]).toBe(0);
  });

  test('onRoot called separately for each flush when roots resolve at different times', async () => {
    let resolveSecond!: () => void;
    const secondWhen = new Promise<null>(r => { resolveSecond = () => r(null); });

    const page = simplePage([
      <Root><div>First</div></Root>,
      <Root when={secondWhen}><div>Second</div></Root>,
    ]);
    const { chunks, rootCalls, done } = run(page);

    // First root flushes immediately
    await new Promise(r => setTimeout(r, 10));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('First');
    expect(rootCalls).toEqual([0]);

    resolveSecond();
    await done;

    expect(rootCalls).toEqual([0, 1]);
  });

  // --- TheFold ---

  test('TheFold calls onTheFold with its token index', async () => {
    const page = simplePage([
      <Root><div>Above</div></Root>,
      <TheFold />,
      <Root><div>Below</div></Root>,
    ]);
    const { foldCalls, done } = run(page);
    await done;

    expect(foldCalls).toEqual([1]);
  });

  test('onTheFold fires before below-fold root is written', async () => {
    let resolveBelow!: () => void;
    const belowWhen = new Promise<null>(r => { resolveBelow = () => r(null); });

    const page = simplePage([
      <Root><div>Above</div></Root>,
      <TheFold />,
      <Root when={belowWhen}><div>Below</div></Root>,
    ]);
    const { foldCalls, chunks, done } = run(page);

    // Above + TheFold should flush before below resolves
    await new Promise(r => setTimeout(r, 10));
    expect(foldCalls).toEqual([1]);
    expect(chunks.join('')).toContain('Above');
    expect(chunks.join('')).not.toContain('Below');

    resolveBelow();
    await done;

    expect(chunks.join('')).toContain('Below');
  });

  test('TheFold-only page does not call onRoot', async () => {
    // TheFold with no roots — onTheFold fires but onRoot should not
    const page = simplePage([
      <TheFold />,
    ]);
    const { rootCalls, foldCalls, onRoot, done } = run(page);
    await done;

    expect(foldCalls).toEqual([0]);
    expect(onRoot).not.toHaveBeenCalled();
  });

  // --- RootContainer (rendering delegated; tested as opaque tokens) ---

  test('RootContainer wraps its children in the output', async () => {
    const page = simplePage([
      <RootContainer id="wrap">
        <Root><div>Inside</div></Root>
      </RootContainer>,
    ]);
    const { chunks, done } = run(page);
    await done;

    const html = chunks.join('');
    expect(html).toContain('Inside');
    // Container open (mocked) should appear before root content, close after
    const openIdx = html.indexOf('data-container=');
    const contentIdx = html.indexOf('Inside');
    const closeIdx = html.lastIndexOf('</div>');
    expect(openIdx).toBeLessThan(contentIdx);
    expect(contentIdx).toBeLessThan(closeIdx);
  });

  // --- error handling ---

  test('renderToString failure skips root without halting stream', async () => {
    const Boom = () => { throw new Error('boom'); };
    const BoomRoot = makeRootComponent<{ children?: React.ReactNode }>(
      () => <Boom />,
      () => ({}),
    );

    const page = simplePage([
      <Root><div>Good</div></Root>,
      <BoomRoot />,
      <Root><div>Also Good</div></Root>,
    ]);
    const { chunks, done } = run(page);
    await done;

    const html = chunks.join('');
    expect(html).toContain('Good');
    expect(html).toContain('Also Good');
    expect(html).not.toContain('boom');
  });

  // --- abort ---

  test('abort skips pending roots and flushes ready ones', async () => {
    const neverResolves = new Promise<null>(() => {});

    const page = simplePage([
      <Root><div>Ready</div></Root>,
      <Root when={neverResolves}><div>Stuck</div></Root>,
      <Root><div>Also Ready</div></Root>,
    ]);
    const { chunks, done } = run(page, { timeoutMs: 50 });
    await done;

    const html = chunks.join('');
    expect(html).toContain('Ready');
    expect(html).toContain('Also Ready');
    expect(html).not.toContain('Stuck');
  });

  test('abort resolves handleBody when all roots are pending', async () => {
    const neverResolves = new Promise<null>(() => {});

    const page = simplePage([
      <Root when={neverResolves}><div>Never</div></Root>,
    ]);
    const { done, write } = run(page, { timeoutMs: 50 });
    await done;

    // Nothing to write — the only root was pending
    expect(write).not.toHaveBeenCalled();
  });

  // --- edge cases ---

  test('empty page completes without calling write, onRoot, or onTheFold', async () => {
    const page = simplePage([]);
    const { write, onRoot, onTheFold, done } = run(page);
    await done;

    expect(write).not.toHaveBeenCalled();
    expect(onRoot).not.toHaveBeenCalled();
    expect(onTheFold).not.toHaveBeenCalled();
  });

  test('page with only containers and no roots', async () => {
    const page = simplePage([
      <RootContainer id="empty">
        {/* no children that tokenize to ROOT */}
      </RootContainer>,
    ]);
    const { chunks, onRoot, done } = run(page);
    await done;

    // Container open/close should be written but onRoot should not fire
    // (no root tokens exist)
    // Container html is written but onRoot should not fire for non-root tokens
    expect(onRoot).not.toHaveBeenCalled();
  });
});
