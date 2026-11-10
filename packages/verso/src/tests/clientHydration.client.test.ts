import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';

// --- Mocks at the boundaries -------------------------------------------------
// hydrateRoot is mocked so we can observe call ordering without doing real React
// work; createRoot is also mocked only because the body transitioner (pulled in
// by the controller's module graph) imports it -- it's never called on the
// hydrate path. nativeFetch is mocked so cache-miss fall-through is observable.
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
import type { ClientSettings } from '../build/config';
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

// --- Pipe driver -------------------------------------------------------------
// We drive the *real* VersoPipe: its writer emits `<script>...</script>` strings
// that the browser would run; here we strip the wrapper and execute the body
// against the jsdom `window`, exactly populating `window.__versoPipe` the way a
// streamed pageload does. The reader (used inside the controller) then sees it.
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

// --- Fixtures ----------------------------------------------------------------
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

// Plant the server-rendered DOM node the controller looks up by token index.
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
      await tick(); // commit runs, handlers register

      hydrateUpTo(1);
      signalRootsComplete();
      await hydrating;

      expect(hydrateRoot).toHaveBeenCalledTimes(2);
      // first arg of each call is the DOM node -- assert document order
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

      hydrateUpTo(0); // only root 0 is "delivered"
      await tick();
      expect(hydrateRoot).toHaveBeenCalledTimes(1);

      hydrateUpTo(1); // now root 1 too
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

      // mid-hydration: not yet idle
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
      // clientInit (cache rehydration) ran before the root hydrated
      expect(clientInitSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        hydrateRoot.mock.invocationCallOrder[0]!,
      );
      clientInitSpy.mockRestore();
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
          latePromise = Fetch.fetch('/api/late'); // cache hit, but entry is still pending
          return [createElement('div', {}, 'A')];
        },
      });

      const hydrating = controller.hydrate();
      await tick();
      hydrateUpTo(0);
      await tick();

      // pipe still open (no SIGNAL_ROOTS_COMPLETE): deliver the late arrival
      lateArrival(
        { url: '/api/late', method: 'GET', body: null },
        { response: { body: { text: '{"late":true}' }, status: 200 }, error: null, requesters: 1 },
      );

      const res = await latePromise;
      expect(await res.text()).toBe('{"late":true}');

      void hydrating; // never settles (SIGNAL_ROOTS_COMPLETE intentionally withheld)
    });

    test('late arrival after roots complete (before end-of-data) is delivered through the pipe', async () => {
      const fetchCache: DehydratedCache = { '/api/late': [pendingEntry()] };
      setupPipe(fetchCache);
      plantRoot(0);

      let latePromise!: Promise<Response>;
      const controller = makeController({
        type: 'page',
        // the root does not depend on the late fetch, so hydration can complete
        // while that fetch is still outstanding
        getElements: () => {
          latePromise = Fetch.fetch('/api/late');
          return [createElement('div', {}, 'A')];
        },
      });

      const hydrating = controller.hydrate();
      await tick();
      hydrateUpTo(0);
      signalRootsComplete();
      await hydrating; // roots settled, but the pipe stays open until end-of-data

      // the server signals roots complete before it finishes piping late arrivals,
      // so a late arrival can legitimately land after `hydrating` resolves. it must
      // still reach the cache -- the pipe is only torn down on FN_SIGNAL_END_OF_DATA.
      lateArrival(
        { url: '/api/late', method: 'GET', body: null },
        { response: { body: { text: '{"late":true}' }, status: 200 }, error: null, requesters: 1 },
      );

      const res = await latePromise;
      expect(await res.text()).toBe('{"late":true}');
    });

    test('FN_SIGNAL_END_OF_DATA tears down the pipe; a later arrival is dropped', async () => {
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

      // end-of-data is the server's "nothing more will be piped" signal
      signalEndOfData();
      await tick(); // let the destroy microtask run
      expect((window as any).__versoPipe).toBeUndefined();

      // an arrival after teardown can't reach the reader: the wire script targets a
      // now-deleted global, so it throws instead of delivering (i.e. it is dropped).
      expect(() =>
        lateArrival(
          { url: '/api/late', method: 'GET', body: null },
          { response: { body: { text: '{"late":true}' }, status: 200 }, error: null, requesters: 1 },
        ),
      ).toThrow();

      // the pending fetch never receives the dropped data
      const settled = await Promise.race([
        latePromise.then(() => 'resolved' as const),
        tick().then(() => 'pending' as const),
      ]);
      expect(settled).toBe('pending');
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

      hydrateUpTo(0); // deliver only root 0
      await tick();
      expect(hydrateRoot).toHaveBeenCalledTimes(1);
      const root0 = hydrateRoot.mock.results[0]!.value as { unmount: ReturnType<typeof vi.fn> };

      abortHydration(); // abort from the next pending root (root 1) onward
      signalRootsComplete();
      await hydrating;

      // root 1 never hydrated
      expect(hydrateRoot).toHaveBeenCalledTimes(1);
      // root 0 remains mounted (not torn down)
      expect(root0.unmount).not.toHaveBeenCalled();
    });

    test('pipe ends unexpectedly: hydration completes with whatever roots were delivered', async () => {
      setupPipe();
      const nodes = [plantRoot(0), plantRoot(1)];
      const controller = makeController({
        type: 'page',
        getElements: () => [createElement('div', {}, 'A'), createElement('div', {}, 'B')],
      });

      const hydrating = controller.hydrate();
      await tick();

      // both roots delivered, but the stream ends here -- no SIGNAL_ROOTS_COMPLETE
      hydrateUpTo(1);
      await tick();

      expect(hydrateRoot).toHaveBeenCalledTimes(2);
      expect(hydrateRoot.mock.calls[0]![0]).toBe(nodes[0]);
      expect(hydrateRoot.mock.calls[1]![0]).toBe(nodes[1]);

      void hydrating; // done waits on SIGNAL_ROOTS_COMPLETE, which never comes
    });
  });
});
