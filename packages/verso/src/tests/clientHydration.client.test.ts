import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';

// createRoot is not used on the hydrate path. It is mocked only because the
// controller's module graph imports it.
const { hydrateRoot, createRoot } = vi.hoisted(() => ({
  hydrateRoot: vi.fn(),
  createRoot: vi.fn(),
}));
vi.mock('react-dom/client', () => ({ hydrateRoot, createRoot }));

const { nativeFetch } = vi.hoisted(() => ({ nativeFetch: vi.fn() }));
vi.mock('../core/common/fetch/nativeFetch', () => ({ nativeFetch }));

import { ClientController } from '../core/client/controller';
import { Resolver } from '../core/common/resolver';
import type { AnyStandardizedHandler } from '../core/common/handler/RouteHandler';
import type { ClientSettings } from '../core/config';
import {
  VersoPipe,
  REQUEST_DATA_KEY,
  FETCH_CACHE_KEY,
  FN_HYDRATE_ROOTS_UP_TO,
  FN_SIGNAL_ROOTS_COMPLETE,
  FN_RECEIVE_LATE_DATA_ARRIVAL,
  FN_ABORT_HYDRATION,
  FN_SIGNAL_END_OF_DATA,
} from '../core/common/VersoPipe';
import { Fetch } from '../core/common/fetch/Fetch';
import type { CacheableRequest, CacheEntryData, DehydratedCache } from '../core/common/fetch/cache';
import { PAGE_ROOT_ELEMENT_ATTR, PAGE_ELEMENT_TOKEN_IDX_ATTR } from '../core/common/constants';
import {tick} from './util/promise';

function execPipeScript(html: string) {
  const js = html.slice('<script>'.length, -'</script>'.length);
  new Function('window', js)(window);
}
const writer = VersoPipe.writer(execPipeScript);

function setupPipe(fetchCache: DehydratedCache = {}) {
  writer.init();
  writer.writeValue(REQUEST_DATA_KEY, {
    method: 'GET',
    url: window.location.href, // must match window.location for hydration to proceed
    body: null,
  });
  writer.writeValue(FETCH_CACHE_KEY, fetchCache);
}

const hydrateUpTo = (n: number) => writer.callFn(FN_HYDRATE_ROOTS_UP_TO, [n]);
const signalRootsComplete = () => writer.callFn(FN_SIGNAL_ROOTS_COMPLETE, []);
const signalEndOfData = () => writer.callFn(FN_SIGNAL_END_OF_DATA, []);
const abortHydration = () => writer.callFn(FN_ABORT_HYDRATION, []);
const lateArrival = (req: CacheableRequest, data: CacheEntryData) =>
  writer.callFn(FN_RECEIVE_LATE_DATA_ARRIVAL, [req, data]);

type StandardizedPageLike = { type: 'page'; getElements: () => React.ReactElement[] };

function makeController(page: StandardizedPageLike) {
  const resolveRoute = vi.fn<Resolver['resolveRoute']>().mockResolvedValue({
    kind: 'response',
    routeName: 'home',
    statusCode: 200,
    handler: page as unknown as AnyStandardizedHandler,
  });
  const resolver = { resolveRoute } as unknown as Resolver;
  const settings: ClientSettings = { reuseDom: false };
  return new ClientController(resolver, null, settings);
}

function plantRoot(i: number): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute(PAGE_ROOT_ELEMENT_ATTR, '');
  el.setAttribute(PAGE_ELEMENT_TOKEN_IDX_ATTR, String(i));
  document.body.appendChild(el);
  return el;
}

const cachedEntry = (text: string): DehydratedCache[string][number] => ({
  aux: { method: 'GET', query: '', body: null },
  data: { response: { body: { text }, status: 200 }, error: null, requesters: 1 },
});

const pendingEntry = (): DehydratedCache[string][number] => ({
  aux: { method: 'GET', query: '', body: null },
  data: { response: null, error: null, requesters: 1 },
});

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as any).__versoPipe;
  hydrateRoot.mockReset();
  hydrateRoot.mockImplementation(() => ({ render: vi.fn(), unmount: vi.fn() }));
  nativeFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClientController.hydrate()', () => {
  describe('Hydration ordering', () => {
    test('roots hydrate in document order', async () => {
      setupPipe();
      const nodes = [plantRoot(0), plantRoot(1)];
      const controller = makeController({
        type: 'page',
        getElements: () => [createElement('div', {}, 'A'), createElement('div', {}, 'B')],
      });

      const hydrating = controller.hydrate();
      await tick();

      hydrateUpTo(1);
      signalRootsComplete();
      await hydrating;

      expect(hydrateRoot).toHaveBeenCalledTimes(2);
      expect(hydrateRoot.mock.calls[0]![0]).toBe(nodes[0]);
      expect(hydrateRoot.mock.calls[1]![0]).toBe(nodes[1]);
    });

    test('FN_HYDRATE_ROOTS_UP_TO triggers progressive hydration up to the specified index', async () => {
      setupPipe();
      plantRoot(0);
      plantRoot(1);
      const controller = makeController({
        type: 'page',
        getElements: () => [createElement('div', {}, 'A'), createElement('div', {}, 'B')],
      });

      const hydrating = controller.hydrate();
      await tick();

      hydrateUpTo(0);
      await tick();
      expect(hydrateRoot).toHaveBeenCalledTimes(1);

      hydrateUpTo(1);
      await tick();
      expect(hydrateRoot).toHaveBeenCalledTimes(2);

      signalRootsComplete();
      await hydrating;
    });

    test('all roots hydrated: the navigation manager settles to idle', async () => {
      setupPipe();
      plantRoot(0);
      const controller = makeController({
        type: 'page',
        getElements: () => [createElement('div', {}, 'A')],
      });

      const hydrating = controller.hydrate();
      await tick();

      let idled = false;
      void window.__versoNavigation.waitForIdle().then(() => { idled = true; });

      hydrateUpTo(0);
      await tick();
      expect(idled).toBe(false);

      signalRootsComplete();
      await hydrating;
      await tick();
      expect(idled).toBe(true);
    });
  });

  describe('Fetch cache integration', () => {
    test('dehydrated cache payload is rehydrated before any root hydrates', async () => {
      const fetchCache: DehydratedCache = { '/api/data': [cachedEntry('{"cached":true}')] };
      setupPipe(fetchCache);
      plantRoot(0);
      const controller = makeController({
        type: 'page',
        getElements: () => [createElement('div', {}, 'A')],
      });

      const clientInitSpy = vi.spyOn(Fetch, 'clientInit');

      const hydrating = controller.hydrate();
      await tick();
      hydrateUpTo(0);
      signalRootsComplete();
      await hydrating;

      expect(clientInitSpy).toHaveBeenCalledWith(fetchCache);
      expect(hydrateRoot).toHaveBeenCalledTimes(1);
      expect(clientInitSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        hydrateRoot.mock.invocationCallOrder[0]!,
      );
    });

    test('cache hit during hydration returns server data without a network request', async () => {
      const fetchCache: DehydratedCache = { '/api/data': [cachedEntry('{"cached":true}')] };
      setupPipe(fetchCache);
      plantRoot(0);

      let fetchPromise!: Promise<Response>;
      const controller = makeController({
        type: 'page',
        getElements: () => {
          fetchPromise = Fetch.fetch('/api/data');
          return [createElement('div', {}, 'A')];
        },
      });

      const hydrating = controller.hydrate();
      await tick();
      hydrateUpTo(0);
      signalRootsComplete();
      await hydrating;

      const res = await fetchPromise;
      expect(await res.text()).toBe('{"cached":true}');
      expect(nativeFetch).not.toHaveBeenCalled();
    });
  });

  describe('Late arrival handling', () => {
    test('FN_RECEIVE_LATE_DATA_ARRIVAL resolves a pending client-side fetch promise', async () => {
      const fetchCache: DehydratedCache = { '/api/late': [pendingEntry()] };
      setupPipe(fetchCache);
      plantRoot(0);

      let latePromise!: Promise<Response>;
      const controller = makeController({
        type: 'page',
        getElements: () => {
          latePromise = Fetch.fetch('/api/late');
          return [createElement('div', {}, 'A')];
        },
      });

      const hydrating = controller.hydrate();
      await tick();
      hydrateUpTo(0);
      await tick();

      lateArrival(
        { url: '/api/late', method: 'GET', body: null },
        { response: { body: { text: '{"late":true}' }, status: 200 }, error: null, requesters: 1 },
      );

      const res = await latePromise;
      expect(await res.text()).toBe('{"late":true}');

      void hydrating; // never settles, because FN_SIGNAL_ROOTS_COMPLETE is not sent
    });

    test('late arrival after roots complete (before end-of-data) is delivered through the pipe', async () => {
      const fetchCache: DehydratedCache = { '/api/late': [pendingEntry()] };
      setupPipe(fetchCache);
      plantRoot(0);

      let latePromise!: Promise<Response>;
      const controller = makeController({
        type: 'page',
        getElements: () => {
          latePromise = Fetch.fetch('/api/late');
          return [createElement('div', {}, 'A')];
        },
      });

      const hydrating = controller.hydrate();
      await tick();
      hydrateUpTo(0);
      signalRootsComplete();
      await hydrating;

      lateArrival(
        { url: '/api/late', method: 'GET', body: null },
        { response: { body: { text: '{"late":true}' }, status: 200 }, error: null, requesters: 1 },
      );

      const res = await latePromise;
      expect(await res.text()).toBe('{"late":true}');
    });

    test('FN_SIGNAL_END_OF_DATA removes the pipe global', async () => {
      setupPipe();
      plantRoot(0);
      const controller = makeController({
        type: 'page',
        getElements: () => [createElement('div', {}, 'A')],
      });

      const hydrating = controller.hydrate();
      await tick();
      hydrateUpTo(0);
      signalRootsComplete();
      await hydrating;
      expect((window as any).__versoPipe).toBeDefined();

      signalEndOfData();
      await tick();
      expect((window as any).__versoPipe).toBeUndefined();
    });
  });

  describe('Abort and error recovery', () => {
    test('abortHydration via pipe skips pending roots; already-hydrated roots remain functional', async () => {
      setupPipe();
      plantRoot(0);
      plantRoot(1);
      const controller = makeController({
        type: 'page',
        getElements: () => [createElement('div', {}, 'A'), createElement('div', {}, 'B')],
      });

      const hydrating = controller.hydrate();
      await tick();

      hydrateUpTo(0);
      await tick();
      expect(hydrateRoot).toHaveBeenCalledTimes(1);
      const root0 = hydrateRoot.mock.results[0]!.value as { unmount: ReturnType<typeof vi.fn> };

      abortHydration();
      signalRootsComplete();
      await hydrating;

      expect(hydrateRoot).toHaveBeenCalledTimes(1);
      expect(root0.unmount).not.toHaveBeenCalled();
    });
  });
});
