import { test, expect, describe, beforeEach, vi } from 'vitest';
import { startRequest } from '@/RequestLocalStorage';

const nativeFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/core/fetch/nativeFetch', () => ({
  nativeFetch: nativeFetchMock,
}));

import { Fetch } from '@/core/fetch/Fetch';
const { serverInit: init, fetch, getCache } = Fetch;
import { FetchCache } from '@/core/fetch/cache';

// --- Helpers ---

const URL_PREFIX = 'http://localhost';

function inRequest<T>(fn: () => T): T {
  return startRequest(() => {
    init(URL_PREFIX);
    return fn();
  });
}

type PendingFetch = {
  url: string;
  resolve: (r: Response) => void;
  reject: (e: Error) => void;
};

function interceptFetch() {
  const pending: PendingFetch[] = [];
  nativeFetchMock.mockReset();
  nativeFetchMock.mockImplementation((url: string) => {
    return new Promise<Response>((resolve, reject) => {
      pending.push({ url, resolve, reject });
    });
  });

  return {
    pending,
    resolve(url: string, body: unknown, status = 200) {
      const resolved = url.startsWith('/') ? URL_PREFIX + url : url;
      const idx = pending.findIndex(p => p.url === resolved);
      if (idx === -1) throw new Error(`no pending native fetch for ${url}`);
      const [entry] = pending.splice(idx, 1);
      entry!.resolve(new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }));
    },
    reject(url: string, error: Error) {
      const resolved = url.startsWith('/') ? URL_PREFIX + url : url;
      const idx = pending.findIndex(p => p.url === resolved);
      if (idx === -1) throw new Error(`no pending native fetch for ${url}`);
      const [entry] = pending.splice(idx, 1);
      entry!.reject(error);
    },
  };
}

// --- Tests ---

describe('fetch cache lifecycle', () => {
  let net: ReturnType<typeof interceptFetch>;

  beforeEach(() => {
    net = interceptFetch();
  });

  // ---------------------------------------------------------------
  // Server-side: first caller
  // ---------------------------------------------------------------

  describe('server-side first caller', () => {
    test('returns a readable response', async () => {
      await inRequest(async () => {
        const responsePromise = fetch('/api/data');
        net.resolve('/api/data', { hello: 'world' });
        const res = await responsePromise;

        const text = await res.text();
        expect(JSON.parse(text)).toEqual({ hello: 'world' });
      });
    });

    test('caches the response for dehydration', async () => {
      await inRequest(async () => {
        const p = fetch('/api/data');
        net.resolve('/api/data', { cached: true });
        await p;

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/data']).toBeDefined();
        expect(dehydrated['/api/data']!.response).not.toBeNull();
        expect(JSON.parse(dehydrated['/api/data']!.response!.text)).toEqual({ cached: true });
      });
    });
  });

  // ---------------------------------------------------------------
  // Server-side: deduplication
  // ---------------------------------------------------------------

  describe('server-side deduplication', () => {
    test('two concurrent fetches to the same URL produce one native fetch', async () => {
      await inRequest(async () => {
        const p1 = fetch('/api/dedup');
        const p2 = fetch('/api/dedup');

        net.resolve('/api/dedup', { value: 42 });

        const [r1, r2] = await Promise.all([p1, p2]);
        const [b1, b2] = await Promise.all([r1.text(), r2.text()]);

        expect(JSON.parse(b1)).toEqual({ value: 42 });
        expect(JSON.parse(b2)).toEqual({ value: 42 });
        expect(nativeFetchMock).toHaveBeenCalledTimes(1);
      });
    });

    test('dehydrated requesters count reflects all concurrent callers', async () => {
      await inRequest(async () => {
        const p1 = fetch('/api/dedup');
        const p2 = fetch('/api/dedup');
        net.resolve('/api/dedup', {});
        await Promise.all([p1, p2]);

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/dedup']!.requesters).toBe(2);
      });
    });
  });

  // ---------------------------------------------------------------
  // Server-side: sequential reads of the same URL
  // ---------------------------------------------------------------

  describe('server-side sequential reads', () => {
    test('second caller after resolution gets a valid response', async () => {
      await inRequest(async () => {
        const p1 = fetch('/api/users');
        net.resolve('/api/users', { id: 1 });
        await p1;

        const res2 = await fetch('/api/users');
        const body = await res2.text();
        expect(JSON.parse(body)).toEqual({ id: 1 });
      });
    });

    test('dehydrated requesters count reflects all sequential callers', async () => {
      await inRequest(async () => {
        const p1 = fetch('/api/count');
        net.resolve('/api/count', 'ok');
        await p1;

        await fetch('/api/count');
        await fetch('/api/count');

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/count']!.requesters).toBe(3);
      });
    });
  });

  // ---------------------------------------------------------------
  // Server-side: fetch rejection
  // ---------------------------------------------------------------

  describe('server-side fetch rejection', () => {
    test('a rejected fetch rejects for all dedup waiters', { timeout: 500 }, async () => {
      await inRequest(async () => {
        const p1 = fetch('/api/fail');
        const p2 = fetch('/api/fail');

        net.reject('/api/fail', new Error('network error'));

        await expect(p1).rejects.toThrow();
        await expect(p2).rejects.toThrow();
      });
    });

    test('a rejected fetch does not linger as pending', async () => {
      await inRequest(async () => {
        const p = fetch('/api/fail');
        net.reject('/api/fail', new Error('boom'));
        await p.catch(() => {});

        const pending = getCache().server().getPending();
        expect(pending.find(p => p.url === '/api/fail')).toBeUndefined();
      });
    });

    test('a rejected fetch dehydrates with the error message', async () => {
      await inRequest(async () => {
        const p = fetch('/api/fail');
        net.reject('/api/fail', new Error('connection refused'));
        await p.catch(() => {});

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/fail']).toBeDefined();
        expect(dehydrated['/api/fail']!.response).toBeNull();
        expect(dehydrated['/api/fail']!.errorMessage).toBe('connection refused');
      });
    });
  });

  // ---------------------------------------------------------------
  // Error dehydration → rehydration round-trip
  // ---------------------------------------------------------------

  describe('error dehydration and rehydration', () => {
    test('client rehydrates a server error entry as a rejected promise', async () => {
      const dehydrated = await inRequest(async () => {
        const p = fetch('/api/fail');
        net.reject('/api/fail', new Error('server DNS failure'));
        await p.catch(() => {});
        return getCache().server().dehydrate();
      });

      const clientCache = new FetchCache();
      clientCache.client().rehydrate(dehydrated);

      const promise = clientCache.client().receiveRequest('/api/fail');
      expect(promise).not.toBeNull();
      await expect(promise!).rejects.toBeDefined();
    });

    test('client consumeResponse cleans up after a rehydrated error', async () => {
      const clientCache = new FetchCache();
      const client = clientCache.client();

      client.rehydrate({
        '/api/fail': { response: null, errorMessage: 'boom', requesters: 1 },
      });

      const promise = client.receiveRequest('/api/fail');
      await promise!.catch(() => {});
      client.consumeResponse('/api/fail');

      expect(client.receiveRequest('/api/fail')).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Dehydration → rehydration round-trip
  // ---------------------------------------------------------------

  describe('dehydration and rehydration', () => {
    test('server dehydrates resolved entry; client rehydrates and reads', async () => {
      const dehydrated = await inRequest(async () => {
        const p = fetch('/api/hydrate');
        net.resolve('/api/hydrate', { server: true });
        await p;
        return getCache().server().dehydrate();
      });

      const clientCache = new FetchCache();
      clientCache.client().rehydrate(dehydrated);

      const promise = clientCache.client().receiveRequest('/api/hydrate');
      expect(promise).not.toBeNull();
      const resolved = await promise!;
      expect(JSON.parse(resolved.text)).toEqual({ server: true });
    });

    test('pending entries dehydrate with null response for late arrival', async () => {
      await inRequest(async () => {
        fetch('/api/slow');

        const cache = getCache();
        const pending = cache.server().getPending();
        expect(pending).toHaveLength(1);

        // dehydrate() returns the live data object, so snapshot before resolving
        const dehydrated = cache.server().dehydrate();
        const snapshot = JSON.parse(JSON.stringify(dehydrated));

        expect(snapshot['/api/slow']).toBeDefined();
        expect(snapshot['/api/slow']!.response).toBeNull();

        // clean up: resolve so the promise chain completes
        net.resolve('/api/slow', {});
        await pending[0]!.promise;
      });
    });
  });

  // ---------------------------------------------------------------
  // Client-side: late arrival
  // ---------------------------------------------------------------

  describe('client-side late arrival', () => {
    test('receiveRequest returns a promise that resolves when receiveCachedResponse is called', async () => {
      const cache = new FetchCache();
      const client = cache.client();

      client.rehydrate({
        '/api/late': { response: null, errorMessage: null, requesters: 1 },
      });

      const promise = client.receiveRequest('/api/late');
      expect(promise).not.toBeNull();

      client.receiveCachedResponse('/api/late', {
        text: '{"late":true}',
        status: 200,
        headers: [],
      });

      const resolved = await promise!;
      expect(JSON.parse(resolved.text)).toEqual({ late: true });
    });

    test('consumeResponse runs after late arrival resolves, not before', async () => {
      const cache = new FetchCache();
      const client = cache.client();

      client.rehydrate({
        '/api/late': { response: null, errorMessage: null, requesters: 1 },
      });

      const promise = client.receiveRequest('/api/late');

      client.receiveCachedResponse('/api/late', {
        text: '{"data":1}',
        status: 200,
        headers: [],
      });

      await promise;

      // consumeResponse after resolution should work cleanly
      client.consumeResponse('/api/late');
    });
  });

  // ---------------------------------------------------------------
  // Client-side: rehydrated cache hit
  // ---------------------------------------------------------------

  describe('client-side rehydrated cache hit', () => {
    test('receiveRequest resolves immediately for a rehydrated resolved entry', async () => {
      const cache = new FetchCache();
      const client = cache.client();

      client.rehydrate({
        '/api/data': {
          response: { text: '{"ready":true}', status: 200, headers: [] },
          errorMessage: null,
          requesters: 1,
        },
      });

      const promise = client.receiveRequest('/api/data');
      expect(promise).not.toBeNull();

      const resolved = await promise!;
      expect(JSON.parse(resolved.text)).toEqual({ ready: true });
    });

    test('receiveRequest returns null for unknown URLs', () => {
      const cache = new FetchCache();
      const client = cache.client();

      expect(client.receiveRequest('/api/unknown')).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Client-side: post-hydration fetch hits the network
  // ---------------------------------------------------------------

  describe('client-side post-hydration', () => {
    test('fetch after consuming all rehydrated entries hits the network', async () => {
      const cache = new FetchCache();
      const client = cache.client();

      client.rehydrate({
        '/api/data': {
          response: { text: '{"old":true}', status: 200, headers: [] },
          errorMessage: null,
          requesters: 1,
        },
      });

      // Consume the entry (simulates the first client-side fetch reading it)
      const promise = client.receiveRequest('/api/data');
      await promise;
      client.consumeResponse('/api/data');

      // After consumption, receiveRequest should return null so fetch()
      // falls through to the network
      expect(client.receiveRequest('/api/data')).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Non-GET requests bypass the cache
  // ---------------------------------------------------------------

  describe('non-GET requests', () => {
    test('POST requests are not cached', async () => {
      await inRequest(async () => {
        const p = fetch('/api/submit', { method: 'POST', body: '{}' });
        expect(net.pending).toHaveLength(1);

        net.resolve('/api/submit', { ok: true });
        const res = await p;
        const body = await res.json();
        expect(body).toEqual({ ok: true });

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/submit']).toBeUndefined();
      });
    });
  });
});
