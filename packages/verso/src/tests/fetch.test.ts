import { test, expect, describe, beforeEach, vi } from 'vitest';
import { startRequest } from '../core/RequestLocalStorage';

const nativeFetchMock = vi.hoisted(() => vi.fn());
vi.mock('../core/fetch/nativeFetch', () => ({
  nativeFetch: nativeFetchMock,
}));

import { Fetch, setFetchInterceptor } from '../core/fetch/Fetch';
const { serverInit: init, fetch, getCache } = Fetch;
import { FetchCache, type CacheableRequest, type CachedResponse } from '../core/fetch/cache';
import { ServerCookies } from '../server/ServerCookies';

// --- Helpers ---

const URL_PREFIX = 'http://localhost';

function inRequest<T>(fn: () => T, opts?: { cookies?: string; fetchOrigin?: 'request' | 'loopback'; port?: number }): T {
  return startRequest(() => {
    const headers: Record<string, string> = {};
    if (opts?.cookies) headers['cookie'] = opts.cookies;
    const nativeRequest = new Request(`${URL_PREFIX}/test`, { headers });
    new ServerCookies(nativeRequest);
    init(nativeRequest, {
      port: opts?.port ?? 80,
      fetchOrigin: opts?.fetchOrigin ?? 'request',
      renderTimeout: 20_000,
    });
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
  nativeFetchMock.mockImplementation((req: Request) => {
    return new Promise<Response>((resolve, reject) => {
      pending.push({ url: req.url, resolve, reject });
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

// Helper: build a CacheableRequest for GET by default
const cacheReq = (url: string, method = 'GET', body: string | null = null): CacheableRequest => ({ url, method, body });

// Helper: build a DehydratedCache value for a single GET entry
type EntryData = { response: CachedResponse | null; error: { message: string } | null; requesters: number };
const dehydratedEntry = (data: EntryData) =>
  [{ aux: { method: 'GET', query: '', body: null }, data }];

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
        expect(dehydrated['/api/data']![0]!.data.response).not.toBeNull();
        expect(JSON.parse(dehydrated['/api/data']![0]!.data.response!.text)).toEqual({ cached: true });
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
        expect(dehydrated['/api/dedup']![0]!.data.requesters).toBe(2);
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
        expect(dehydrated['/api/count']![0]!.data.requesters).toBe(3);
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
        expect(pending.find(p => p.request.url === '/api/fail')).toBeUndefined();
      });
    });

    test('a rejected fetch dehydrates with the error message', async () => {
      await inRequest(async () => {
        const p = fetch('/api/fail');
        net.reject('/api/fail', new Error('connection refused'));
        await p.catch(() => {});

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/fail']).toBeDefined();
        expect(dehydrated['/api/fail']![0]!.data.response).toBeNull();
        expect(dehydrated['/api/fail']![0]!.data.error!.message).toBe('connection refused');
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

      const promise = clientCache.client().receiveRequest(cacheReq('/api/fail'));
      expect(promise).not.toBeNull();
      await expect(promise!).rejects.toBeDefined();
    });

    test('client consumeResponse cleans up after a rehydrated error', async () => {
      const clientCache = new FetchCache();
      const client = clientCache.client();

      client.rehydrate({
        '/api/fail': dehydratedEntry({ response: null, error: { message: 'boom' }, requesters: 1 }),
      });

      const promise = client.receiveRequest(cacheReq('/api/fail'));
      await promise!.catch(() => {});
      client.consumeResponse(cacheReq('/api/fail'));

      expect(client.receiveRequest(cacheReq('/api/fail'))).toBeNull();
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

      const promise = clientCache.client().receiveRequest(cacheReq('/api/hydrate'));
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
        expect(snapshot['/api/slow']![0]!.data.response).toBeNull();

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
        '/api/late': dehydratedEntry({ response: null, error: null, requesters: 1 }),
      });

      const promise = client.receiveRequest(cacheReq('/api/late'));
      expect(promise).not.toBeNull();

      client.receiveCachedResponse(cacheReq('/api/late'), {
        text: '{"late":true}',
        status: 200,
      });

      const resolved = await promise!;
      expect(JSON.parse(resolved.text)).toEqual({ late: true });
    });

    test('consumeResponse runs after late arrival resolves, not before', async () => {
      const cache = new FetchCache();
      const client = cache.client();

      client.rehydrate({
        '/api/late': dehydratedEntry({ response: null, error: null, requesters: 1 }),
      });

      const promise = client.receiveRequest(cacheReq('/api/late'));

      client.receiveCachedResponse(cacheReq('/api/late'), {
        text: '{"data":1}',
        status: 200,
      });

      await promise;

      // consumeResponse after resolution should work cleanly
      client.consumeResponse(cacheReq('/api/late'));
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
        '/api/data': dehydratedEntry({
          response: { text: '{"ready":true}', status: 200 },
          error: null,
          requesters: 1,
        }),
      });

      const promise = client.receiveRequest(cacheReq('/api/data'));
      expect(promise).not.toBeNull();

      const resolved = await promise!;
      expect(JSON.parse(resolved.text)).toEqual({ ready: true });
    });

    test('receiveRequest returns null for unknown URLs', () => {
      const cache = new FetchCache();
      const client = cache.client();

      expect(client.receiveRequest(cacheReq('/api/unknown'))).toBeNull();
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
        '/api/data': dehydratedEntry({
          response: { text: '{"old":true}', status: 200 },
          error: null,
          requesters: 1,
        }),
      });

      // Consume the entry (simulates the first client-side fetch reading it)
      const promise = client.receiveRequest(cacheReq('/api/data'));
      await promise;
      client.consumeResponse(cacheReq('/api/data'));

      // After consumption, receiveRequest should return null so fetch()
      // falls through to the network
      expect(client.receiveRequest(cacheReq('/api/data'))).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Non-GET requests bypass the cache
  // ---------------------------------------------------------------

  describe('non-GET requests', () => {
    test('concurrent GET and POST to the same URL do not dedup', async () => {
      await inRequest(async () => {
        const pGet = fetch('/api/submit');
        const pPost = fetch('/api/submit', { method: 'POST', body: '{}' });

        expect(net.pending).toHaveLength(2);

        net.resolve('/api/submit', { method: 'get' });
        net.resolve('/api/submit', { method: 'post' });

        const [rGet, rPost] = await Promise.all([pGet, pPost]);
        expect(await rGet.json()).toEqual({ method: 'get' });
        expect(await rPost.json()).toEqual({ method: 'post' });
        expect(nativeFetchMock).toHaveBeenCalledTimes(2);
      });
    });

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

  // ---------------------------------------------------------------
  // Fetch request interceptor
  // ---------------------------------------------------------------

  describe('fetch request interceptor', () => {
    test('interceptor can rewrite the URL', async () => {
      await inRequest(async () => {
        setFetchInterceptor((url, init) => ({
          url: '/api/rewritten',
          init,
        }));

        const p = fetch('/api/original');
        net.resolve('/api/rewritten', { rewritten: true });
        const res = await p;
        expect(await res.json()).toEqual({ rewritten: true });

        // cache key is rawUrl (pre-interception), not the rewritten URL
        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/original']).toBeDefined();
        // verify the rewritten URL was actually fetched
        expect((nativeFetchMock.mock.calls[0]![0] as Request).url).toBe(`${URL_PREFIX}/api/rewritten`);
      });
    });

    test('interceptor can add headers via init', async () => {
      await inRequest(async () => {
        setFetchInterceptor((url, init) => ({
          url,
          init: { ...init, headers: { 'X-Custom': 'test' } },
        }));

        const p = fetch('/api/data');
        net.resolve('/api/data', { ok: true });
        await p;

        const callReq: Request = nativeFetchMock.mock.calls[0]![0];
        expect(callReq.headers.get('X-Custom')).toBe('test');
      });
    });

    test('forceToCache caches a POST request', async () => {
      await inRequest(async () => {
        setFetchInterceptor((url, init) => ({
          url,
          init,
          settings: { forceToCache: true },
        }));

        const p = fetch('/api/submit', { method: 'POST', body: '{}' });
        net.resolve('/api/submit', { forced: true });
        await p;

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/submit']).toBeDefined();
        expect(JSON.parse(dehydrated['/api/submit']![0]!.data.response!.text)).toEqual({ forced: true });
      });
    });
  });

  // ---------------------------------------------------------------
  // Binary response handling
  // ---------------------------------------------------------------

  describe('binary response handling', () => {
    test('binary responses skip the cache by default', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' },
          }),
        );

        const res = await fetch('/api/binary');
        // evicted responses are clones of the original and retain headers
        expect(res.headers.get('Content-Type')).toBe('application/octet-stream');

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/binary']).toBeUndefined();
      });
    });

    test('forceBinaryToCache encodes binary response as base64', async () => {
      await inRequest(async () => {
        setFetchInterceptor((url, init) => ({
          url,
          init,
          settings: { forceBinaryToCache: true },
        }));

        const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        nativeFetchMock.mockResolvedValueOnce(
          new Response(bytes, {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' },
          }),
        );

        const res = await fetch('/api/binary');
        const body = await res.arrayBuffer();
        expect(new Uint8Array(body)).toEqual(bytes);

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/binary']).toBeDefined();
        expect(dehydrated['/api/binary']![0]!.data.response!.isBinary).toBe(true);
      });
    });

    test('text content types are not treated as binary', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response('{"ok":true}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        await fetch('/api/json');

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/json']).toBeDefined();
        expect(dehydrated['/api/json']![0]!.data.response!.isBinary).toBeFalsy();
      });
    });

    test('application/foo+json is treated as text', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/vnd.api+json' },
          }),
        );

        await fetch('/api/jsonapi');

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/jsonapi']).toBeDefined();
      });
    });
  });

  // ---------------------------------------------------------------
  // Cache eviction (binary concurrent callers)
  // ---------------------------------------------------------------

  describe('cache eviction', () => {
    test('concurrent callers to an evicted binary URL both get a response via one native fetch', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response(new Uint8Array([1]), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          }),
        );

        const p1 = fetch('/api/image');
        const p2 = fetch('/api/image');

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(nativeFetchMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ---------------------------------------------------------------
  // Cookie forwarding
  // ---------------------------------------------------------------

  describe('cookie forwarding', () => {
    test('same-origin (relative URL) forwards cookies', async () => {
      await inRequest(async () => {
        const p = fetch('/api/data');
        net.resolve('/api/data', { ok: true });
        await p;

        const callReq: Request = nativeFetchMock.mock.calls[0]![0];
        expect(callReq.headers.has('Cookie')).toBe(true);
      }, { cookies: 'session=abc' });
    });

    test('cross-origin does not forward cookies by default', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );

        await fetch('https://external.com/api/data');

        const callReq: Request = nativeFetchMock.mock.calls[0]![0];
        expect(callReq.headers.has('Cookie')).toBe(false);
      }, { cookies: 'session=abc' });
    });

    test('credentials: "include" forwards cookies to cross-origin', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );

        await fetch('https://external.com/api/data', { credentials: 'include' });

        const callReq: Request = nativeFetchMock.mock.calls[0]![0];
        expect(callReq.headers.has('Cookie')).toBe(true);
      }, { cookies: 'session=abc' });
    });

    test('credentials: "omit" does not forward cookies even for same-origin', async () => {
      await inRequest(async () => {
        const p = fetch('/api/data', { credentials: 'omit' });
        net.resolve('/api/data', { ok: true });
        await p;

        const callReq: Request = nativeFetchMock.mock.calls[0]![0];
        expect(callReq.headers.has('Cookie')).toBe(false);
      }, { cookies: 'session=abc' });
    });

    test('forceForwardRequestCookies forwards cookies to cross-origin', async () => {
      await inRequest(async () => {
        setFetchInterceptor((url, init) => ({
          url,
          init,
          settings: { forceForwardRequestCookies: true },
        }));

        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );

        await fetch('https://external.com/api/data');

        const callReq: Request = nativeFetchMock.mock.calls[0]![0];
        expect(callReq.headers.has('Cookie')).toBe(true);
      }, { cookies: 'session=abc' });
    });
  });

  // ---------------------------------------------------------------
  // forwardSetCookieHeaders
  // ---------------------------------------------------------------

  describe('forwardSetCookieHeaders', () => {
    test('Set-Cookie headers from the fetch response are forwarded to the page response', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response('{"ok":true}', {
            status: 200,
            headers: [
              ['Content-Type', 'application/json'],
              ['Set-Cookie', 'session=abc123; Path=/; HttpOnly'],
            ],
          }),
        );

        await fetch('/api/user-info', {}, { forwardResponseSetCookieHeaders: true });

        const cookies = ServerCookies.get()!;
        expect(cookies.getResponseCookie('session')).toBe('abc123');
      });
    });

    test('multiple Set-Cookie headers are all forwarded', async () => {
      await inRequest(async () => {
        const headers = new Headers();
        headers.append('Content-Type', 'application/json');
        headers.append('Set-Cookie', 'a=1; Path=/');
        headers.append('Set-Cookie', 'b=2; Path=/');

        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', { status: 200, headers }),
        );

        await fetch('/api/user-info', {}, { forwardResponseSetCookieHeaders: true });

        const cookies = ServerCookies.get()!;
        expect(cookies.getResponseCookie('a')).toBe('1');
        expect(cookies.getResponseCookie('b')).toBe('2');
      });
    });

    test('Set-Cookie headers are not forwarded when forwardSetCookieHeaders is not set', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', {
            status: 200,
            headers: [
              ['Content-Type', 'application/json'],
              ['Set-Cookie', 'session=abc; Path=/'],
            ],
          }),
        );

        await fetch('/api/data');

        const cookies = ServerCookies.get()!;
        expect(cookies.getResponseCookie('session')).toBeUndefined();
      });
    });

    test('forwardSetCookieHeaders can be set via interceptor settings', async () => {
      await inRequest(async () => {
        setFetchInterceptor((url, init) => ({
          url,
          init,
          settings: { forwardResponseSetCookieHeaders: true },
        }));

        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', {
            status: 200,
            headers: [
              ['Content-Type', 'application/json'],
              ['Set-Cookie', 'token=xyz; Path=/'],
            ],
          }),
        );

        await fetch('/api/user-info');

        const cookies = ServerCookies.get()!;
        expect(cookies.getResponseCookie('token')).toBe('xyz');
      });
    });

    test('deduplicated fetches only forward Set-Cookie once', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', {
            status: 200,
            headers: [
              ['Content-Type', 'application/json'],
              ['Set-Cookie', 'session=abc; Path=/'],
            ],
          }),
        );

        const p1 = fetch('/api/user-info', {}, { forwardResponseSetCookieHeaders: true });
        const p2 = fetch('/api/user-info', {}, { forwardResponseSetCookieHeaders: true });
        await Promise.all([p1, p2]);

        expect(nativeFetchMock).toHaveBeenCalledTimes(1);
        const cookies = ServerCookies.get()!;
        expect(cookies.getResponseCookie('session')).toBe('abc');
      });
    });
  });

  // ---------------------------------------------------------------
  // fetchOrigin: loopback
  // ---------------------------------------------------------------

  describe('fetchOrigin: loopback', () => {
    test('relative URLs resolve to localhost:port when fetchOrigin is loopback', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );

        await fetch('/api/data');

        const calledUrl = (nativeFetchMock.mock.calls[0]![0] as Request).url;
        expect(calledUrl).toBe('http://localhost:4000/api/data');
      }, { fetchOrigin: 'loopback', port: 4000 });
    });

    test('relative URLs resolve to request origin when fetchOrigin is request', async () => {
      await inRequest(async () => {
        const p = fetch('/api/data');
        net.resolve('/api/data', { ok: true });
        await p;

        const calledUrl = (nativeFetchMock.mock.calls[0]![0] as Request).url;
        expect(calledUrl).toBe('http://localhost/api/data');
      }, { fetchOrigin: 'request' });
    });
  });

  // ---------------------------------------------------------------
  // Query parameter normalization
  // ---------------------------------------------------------------

  describe('query parameter normalization', () => {
    test('same params in different order dedup to one native fetch', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response('{"deduped":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );

        const p1 = fetch('/api/data?b=2&a=1');
        const p2 = fetch('/api/data?a=1&b=2');

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(await r1.json()).toEqual({ deduped: true });
        expect(await r2.json()).toEqual({ deduped: true });
        expect(nativeFetchMock).toHaveBeenCalledTimes(1);
      });
    });

    test('different query params do not dedup', async () => {
      await inRequest(async () => {
        nativeFetchMock
          .mockResolvedValueOnce(new Response('"one"', { status: 200, headers: { 'Content-Type': 'application/json' } }))
          .mockResolvedValueOnce(new Response('"two"', { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const p1 = fetch('/api/data?a=1');
        const p2 = fetch('/api/data?b=2');

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(await r1.json()).toBe('one');
        expect(await r2.json()).toBe('two');
        expect(nativeFetchMock).toHaveBeenCalledTimes(2);
      });
    });

    test('path with no query and path with query are distinct entries', async () => {
      await inRequest(async () => {
        nativeFetchMock
          .mockResolvedValueOnce(new Response('"noquery"', { status: 200, headers: { 'Content-Type': 'application/json' } }))
          .mockResolvedValueOnce(new Response('"withquery"', { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const p1 = fetch('/api/data');
        const p2 = fetch('/api/data?a=1');

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(await r1.json()).toBe('noquery');
        expect(await r2.json()).toBe('withquery');
        expect(nativeFetchMock).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ---------------------------------------------------------------
  // Same path, different POST bodies are distinct cache entries
  // ---------------------------------------------------------------

  describe('post body cache keying', () => {
    test('forceToCache POSTs with different bodies are distinct entries', async () => {
      await inRequest(async () => {
        setFetchInterceptor((url, init) => ({ url, init, settings: { forceToCache: true } }));

        nativeFetchMock
          .mockResolvedValueOnce(new Response('"r1"', { status: 200, headers: { 'Content-Type': 'application/json' } }))
          .mockResolvedValueOnce(new Response('"r2"', { status: 200, headers: { 'Content-Type': 'application/json' } }));

        await fetch('/api/submit', { method: 'POST', body: '{"id":1}' });
        await fetch('/api/submit', { method: 'POST', body: '{"id":2}' });

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/submit']).toHaveLength(2);
        expect(nativeFetchMock).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ---------------------------------------------------------------
  // isSameOrigin: absolute same-origin URL forwards cookies
  // ---------------------------------------------------------------

  describe('same-origin detection', () => {
    test('absolute URL matching request origin forwards cookies', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );

        await fetch('http://localhost/api/data');

        const callReq: Request = nativeFetchMock.mock.calls[0]![0];
        expect(callReq.headers.has('Cookie')).toBe(true);
      }, { cookies: 'session=abc' });
    });
  });

  // ---------------------------------------------------------------
  // credentials: 'omit' overrides forceForwardRequestCookies
  // ---------------------------------------------------------------

  describe('credentials omit overrides forceForwardRequestCookies', () => {
    test('omit blocks cookies even when forceForwardRequestCookies is set', async () => {
      await inRequest(async () => {
        setFetchInterceptor((url, init) => ({ url, init, settings: { forceForwardRequestCookies: true } }));

        nativeFetchMock.mockResolvedValueOnce(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );

        await fetch('https://external.com/api/data', { credentials: 'omit' });

        const callReq: Request = nativeFetchMock.mock.calls[0]![0];
        expect(callReq.headers.has('Cookie')).toBe(false);
      }, { cookies: 'session=abc' });
    });
  });

  // ---------------------------------------------------------------
  // Evicted entries excluded from dehydrated output
  // ---------------------------------------------------------------

  describe('evicted entries in dehydrated output', () => {
    test('evicted binary entries do not appear in dehydrate()', async () => {
      await inRequest(async () => {
        nativeFetchMock.mockResolvedValueOnce(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          }),
        );

        await fetch('/api/image');

        const dehydrated = getCache().server().dehydrate();
        expect(dehydrated['/api/image']).toBeUndefined();
      });
    });
  });

  // ---------------------------------------------------------------
  // forceToCache binary round-trip (server → client)
  // ---------------------------------------------------------------

  describe('forceToCache binary round-trip', () => {
    test('server base64-encodes binary; client rehydrates and decodes bytes', async () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

      const dehydrated = await inRequest(async () => {
        setFetchInterceptor((url, init) => ({ url, init, settings: { forceBinaryToCache: true } }));

        nativeFetchMock.mockResolvedValueOnce(
          new Response(bytes, {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' },
          }),
        );

        await fetch('/api/binary');
        return getCache().server().dehydrate();
      });

      const clientCache = new FetchCache();
      clientCache.client().rehydrate(dehydrated);

      const promise = clientCache.client().receiveRequest(cacheReq('/api/binary'));
      expect(promise).not.toBeNull();

      const cached = await promise!;
      expect(cached.isBinary).toBe(true);
      expect(Uint8Array.fromBase64(cached.text)).toEqual(bytes);
    });
  });

  // ---------------------------------------------------------------
  // resolveRelativeUrl throws when origin is unset
  // ---------------------------------------------------------------

  describe('resolveRelativeUrl error', () => {
    test('throws when no relativeUrlPrefix is set for a relative URL', async () => {
      await startRequest(async () => {
        new ServerCookies(new Request('http://localhost/test'));
        // init() is not called — relativeUrlPrefix stays unset
        await expect(fetch('/api/data')).rejects.toThrow('[verso]');
      });
    });
  });
});
