import { describe, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Serve } from '@verso-js/contract';
import { Fetch, setFetchInterceptor } from '../core/common/fetch/Fetch';
import { nativeFetch } from '../core/common/fetch/nativeFetch';
import type { DehydratedCache } from '../core/common/fetch/cache';
import type { ServerSettings } from '../core/config';
import { ServerCookies } from '../core/server/ServerCookies';
import { testWithRLS } from '../userland/testing/rls';
import { serverSide, clientSide } from '../userland/testing/isomorphic';

// nativeFetch captures globalThis.fetch at import, so a global stub has no effect
vi.mock('../core/common/fetch/nativeFetch', () => ({ nativeFetch: vi.fn() }));

const mockFetch = vi.mocked(nativeFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function fullSettings(overrides?: Partial<ServerSettings>): ServerSettings {
  return {
    allowedHosts: ['localhost'],
    trustProxy: false,
    fetchOrigin: 'request-host',
    failsafeTtfbDeadlineMs: 20_000,
    failsafeResponseDeadlineMs: 20_000,
    ...overrides,
  };
}

function loopbackStub(): Mock<Serve> {
  return vi.fn<Serve>(async () => new Response('loopback'));
}

function initServer(opts: {
  request?: Request;
  settings?: Partial<ServerSettings>;
  loopback?: Serve;
  cookies?: boolean;
} = {}) {
  const request = opts.request ?? new Request('https://app.example.com/');
  const loopback = opts.loopback ?? loopbackStub();
  Fetch.serverInit(request, loopback, fullSettings(opts.settings));
  if (opts.cookies) new ServerCookies(request);
  return { request, loopback };
}

function dehydrate(): DehydratedCache {
  return Fetch.getServerCache()!.dehydrate();
}

function nativeFetchRequest(call = 0): Request {
  return mockFetch.mock.calls[call]![0] as Request;
}

const jsonResponse = (body = '{"x":1}') =>
  new Response(body, { headers: { 'Content-Type': 'application/json' } });

// the URL parser reads each of these as a new host, not a path
const crossOriginSlashUrls = [
  '//other.example.com/api',
  '/\\other.example.com/api',
  '/\t/other.example.com/api',
];

describe('Fetch orchestration', () => {
  serverSide(() => {
    describe('Server-side request orchestration', () => {
      testWithRLS('two concurrent GETs to the same URL hit nativeFetch once; both get the data', async () => {
        mockFetch.mockResolvedValue(jsonResponse('{"hello":"world"}'));
        initServer();
        const url = 'https://api.example.com/data';
        const [r1, r2] = await Promise.all([Fetch.fetch(url), Fetch.fetch(url)]);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(await r1.text()).toBe('{"hello":"world"}');
        expect(await r2.text()).toBe('{"hello":"world"}');
      });

      testWithRLS('POST bypasses the cache: each call hits nativeFetch', async () => {
        mockFetch.mockImplementation(async () => jsonResponse());
        initServer();
        const url = 'https://api.example.com/data';
        await Promise.all([
          Fetch.fetch(url, { method: 'POST' }),
          Fetch.fetch(url, { method: 'POST' }),
        ]);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      testWithRLS('POST with forceToCache is deduped/cached like a GET', async () => {
        mockFetch.mockResolvedValue(jsonResponse());
        initServer();
        const url = 'https://api.example.com/data';
        await Promise.all([
          Fetch.fetch(url, { method: 'POST' }, { forceToCache: true }),
          Fetch.fetch(url, { method: 'POST' }, { forceToCache: true }),
        ]);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(dehydrate()['https://api.example.com/data']).toHaveLength(1);
      });

      testWithRLS('binary response without forceBinaryToCache: caller gets bytes, entry evicted from dehydrate', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5]);
        mockFetch.mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
        initServer();
        const url = 'https://api.example.com/img';
        const res = await Fetch.fetch(url);
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
        expect(dehydrate()[url]).toBeUndefined();
      });

      testWithRLS('binary response with forceBinaryToCache: present in dehydrate', async () => {
        mockFetch.mockResolvedValue(new Response(new Uint8Array([9, 8, 7]), { headers: { 'Content-Type': 'image/png' } }));
        initServer();
        const url = 'https://api.example.com/img';
        await Fetch.fetch(url, {}, { forceBinaryToCache: true });
        expect(dehydrate()[url]).toHaveLength(1);
      });

      testWithRLS('nativeFetch rejects: caller rejects and the error is captured in dehydrate', async () => {
        mockFetch.mockRejectedValue(new Error('network failure'));
        initServer();
        const url = 'https://api.example.com/data';
        await expect(Fetch.fetch(url)).rejects.toThrow('network failure');
        const entry = dehydrate()[url]![0]!;
        expect(entry.data.error).toEqual({ name: 'Error', message: 'network failure' });
        expect(entry.data.response).toBeNull();
      });

      testWithRLS('resolved GET is captured in dehydrate with the response data', async () => {
        mockFetch.mockResolvedValue(jsonResponse('{"a":1}'));
        initServer();
        const url = 'https://api.example.com/data';
        await Fetch.fetch(url);
        const entry = dehydrate()[url]![0]!;
        expect(entry.data.response).toEqual({ body: { text: '{"a":1}' }, status: 200 });
      });
    });

    describe('Origin / loopback resolution', () => {
      testWithRLS('relative URL with fetchOrigin "loopback" routes through the loopback Serve, not nativeFetch', async () => {
        const loopback = loopbackStub();
        initServer({ settings: { fetchOrigin: 'loopback' }, loopback, cookies: true });
        await Fetch.fetch('/api/data');
        expect(loopback).toHaveBeenCalledTimes(1);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      testWithRLS('without the loopback setting, a relative URL resolves against the request origin and hits nativeFetch', async () => {
        mockFetch.mockResolvedValue(new Response('ok', { headers: { 'Content-Type': 'text/plain' } }));
        const loopback = loopbackStub();
        initServer({ request: new Request('https://app.example.com/'), loopback, cookies: true });
        await Fetch.fetch('/api/data');
        expect(loopback).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(nativeFetchRequest().url).toBe('https://app.example.com/api/data');
      });

      testWithRLS.each(crossOriginSlashUrls)('a URL that starts with "/" but parses to another host (%j) does not use loopback', async (url) => {
        mockFetch.mockResolvedValue(jsonResponse());
        const loopback = loopbackStub();
        initServer({ settings: { fetchOrigin: 'loopback' }, loopback, cookies: true });
        await Fetch.fetch(url);
        expect(loopback).not.toHaveBeenCalled();
        expect(nativeFetchRequest().url).toBe('https://other.example.com/api');
      });
    });

    describe('Interceptors', () => {
      testWithRLS('interceptor rewrites the URL: nativeFetch gets the rewritten URL, cache key stays the original', async () => {
        mockFetch.mockResolvedValue(jsonResponse());
        initServer();
        setFetchInterceptor((url, init) => ({
          url: url === 'https://public.example.com/data' ? 'https://private.internal/data' : url,
          init,
        }));
        await Fetch.fetch('https://public.example.com/data');
        expect(nativeFetchRequest().url).toBe('https://private.internal/data');
        expect(Object.keys(dehydrate())).toEqual(['https://public.example.com/data']);
      });

      testWithRLS('interceptor injects headers: they appear on the Request passed to nativeFetch', async () => {
        mockFetch.mockResolvedValue(jsonResponse());
        initServer();
        setFetchInterceptor((url) => ({ url, init: { headers: { 'X-Custom': 'yes' } } }));
        await Fetch.fetch('https://api.example.com/data');
        expect(nativeFetchRequest().headers.get('X-Custom')).toBe('yes');
      });

      testWithRLS('interceptor rewrites the body: nativeFetch gets the new body, cache key keeps the raw body', async () => {
        mockFetch.mockResolvedValue(jsonResponse());
        initServer();
        setFetchInterceptor((url, init) => ({ url, init: { ...init, body: 'intercepted' } }));
        const url = 'https://api.example.com/data';
        await Fetch.fetch(url, { method: 'POST', body: 'raw' }, { forceToCache: true });
        expect(await nativeFetchRequest().text()).toBe('intercepted');
        expect(dehydrate()[url]![0]!.aux.body).toBe('raw');
      });

      testWithRLS('interceptor rewrites the method: nativeFetch gets the new method, cache key keeps the raw method', async () => {
        mockFetch.mockResolvedValue(jsonResponse());
        initServer();
        setFetchInterceptor((url, init) => ({ url, init: { ...init, method: 'PUT' } }));
        const url = 'https://api.example.com/data';
        await Fetch.fetch(url, { method: 'POST' }, { forceToCache: true });
        expect(nativeFetchRequest().method).toBe('PUT');
        expect(dehydrate()[url]![0]!.aux.method).toBe('POST');
      });

      testWithRLS('no interceptor set: URL passes through unchanged (default identity)', async () => {
        mockFetch.mockResolvedValue(jsonResponse());
        initServer();
        await Fetch.fetch('https://api.example.com/data');
        expect(nativeFetchRequest().url).toBe('https://api.example.com/data');
      });
    });

    describe('Cookie forwarding', () => {
      const withCookies = new Request('https://app.example.com/', {
        headers: { cookie: 'session=abc' },
      });

      testWithRLS('same-origin fetch auto-forwards the request cookies', async () => {
        mockFetch.mockResolvedValue(new Response('ok', { headers: { 'Content-Type': 'text/plain' } }));
        initServer({ request: withCookies, cookies: true });
        await Fetch.fetch('/api/data');
        expect(nativeFetchRequest().headers.get('Cookie')).toBe('session=abc');
      });

      testWithRLS('cross-origin does not forward by default', async () => {
        mockFetch.mockResolvedValue(jsonResponse());
        initServer({ request: withCookies, cookies: true });
        await Fetch.fetch('https://other.example.com/api');
        expect(nativeFetchRequest().headers.get('Cookie')).toBeNull();
      });

      testWithRLS.each(crossOriginSlashUrls)('a URL that starts with "/" but parses to another host (%j) does not forward by default', async (url) => {
        mockFetch.mockResolvedValue(jsonResponse());
        initServer({ request: withCookies, cookies: true });
        await Fetch.fetch(url);
        expect(nativeFetchRequest().url).toBe('https://other.example.com/api');
        expect(nativeFetchRequest().headers.get('Cookie')).toBeNull();
      });

      testWithRLS('credentials "include" forces forwarding cross-origin', async () => {
        mockFetch.mockResolvedValue(jsonResponse());
        initServer({ request: withCookies, cookies: true });
        await Fetch.fetch('https://other.example.com/api', { credentials: 'include' });
        expect(nativeFetchRequest().headers.get('Cookie')).toBe('session=abc');
      });

      testWithRLS('credentials "omit" prevents forwarding even same-origin', async () => {
        mockFetch.mockResolvedValue(new Response('ok', { headers: { 'Content-Type': 'text/plain' } }));
        initServer({ request: withCookies, cookies: true });
        await Fetch.fetch('/api/data', { credentials: 'omit' });
        expect(nativeFetchRequest().headers.get('Cookie')).toBeNull();
      });

      testWithRLS('forceForwardRequestCookies forces forwarding regardless of origin', async () => {
        mockFetch.mockResolvedValue(jsonResponse());
        initServer({ request: withCookies, cookies: true });
        await Fetch.fetch('https://other.example.com/api', {}, { forceForwardRequestCookies: true });
        expect(nativeFetchRequest().headers.get('Cookie')).toBe('session=abc');
      });

      testWithRLS('forwardResponseSetCookieHeaders attaches the fetch response Set-Cookie to the page response', async () => {
        mockFetch.mockResolvedValue(
          new Response('ok', {
            headers: { 'Content-Type': 'text/plain', 'Set-Cookie': 'fromFetch=1; Path=/' },
          }),
        );
        initServer({ request: withCookies, cookies: true });
        await Fetch.fetch('/api/data', {}, { forwardResponseSetCookieHeaders: true });
        expect(ServerCookies.get()!.getResponseCookie('fromFetch')).toEqual({ kind: 'value', value: '1' });
      });
    });

    describe('Content-type-driven caching decision', () => {
      async function fetchAndCheckCached(contentType: string | null): Promise<boolean> {
        const url = 'https://api.example.com/resource';
        const headers: Record<string, string> = {};
        if (contentType) headers['Content-Type'] = contentType;
        // a string body would get an automatic text/plain Content-Type
        mockFetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers }));
        initServer();
        await Fetch.fetch(url);
        return dehydrate()[url] !== undefined;
      }

      testWithRLS.each(['text/html', 'application/json', 'text/plain'])(
        '%s is treated as text -> cached/present in dehydrate',
        async (ct) => {
          expect(await fetchAndCheckCached(ct)).toBe(true);
        },
      );

      testWithRLS.each(['image/png', 'application/octet-stream'])(
        '%s is treated as binary -> evicted/absent from dehydrate',
        async (ct) => {
          expect(await fetchAndCheckCached(ct)).toBe(false);
        },
      );

      testWithRLS('missing Content-Type is treated as binary -> absent from dehydrate', async () => {
        expect(await fetchAndCheckCached(null)).toBe(false);
      });

      testWithRLS('no body and no Content-Type is not binary -> cached with its status', async () => {
        const url = 'https://api.example.com/resource';
        mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
        initServer();
        const res = await Fetch.fetch(url);
        expect(res.status).toBe(204);
        expect(dehydrate()[url]?.[0]?.data.response).toEqual({ body: null, status: 204 });
      });
    });
  });

  clientSide(() => {
    const URL = 'https://api.example.com/data';

    function dehydratedWith(requesters = 1): DehydratedCache {
      return {
        [URL]: [
          {
            aux: { method: 'GET', query: '', body: null },
            data: { response: { body: { text: '{"cached":true}' }, status: 200 }, error: null, requesters },
          },
        ],
      };
    }

    describe('Client-side fetch branch', () => {
      testWithRLS('cache hit replays server data with no nativeFetch call, then consumes the entry', async () => {
        Fetch.clientInit(dehydratedWith(1));

        const hit = await Fetch.fetch(URL);
        expect(mockFetch).not.toHaveBeenCalled();
        expect(await hit.text()).toBe('{"cached":true}');

        mockFetch.mockResolvedValue(new Response('fresh', { headers: { 'Content-Type': 'text/plain' } }));
        await Fetch.fetch(URL);
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      testWithRLS('a pending entry evicted by a late arrival falls back to nativeFetch', async () => {
        mockFetch.mockResolvedValue(new Response('fresh', { headers: { 'Content-Type': 'application/octet-stream' } }));
        Fetch.clientInit({
          [URL]: [{
            aux: { method: 'GET', query: '', body: null },
            data: { response: null, error: null, requesters: 1 },
          }],
        });

        const pending = Fetch.fetch(URL);
        // the entry is still pending, so the fetch waits on the cache
        expect(mockFetch).not.toHaveBeenCalled();

        Fetch.getClientCache()!.receiveLateArrivalEviction({ url: URL, method: 'GET', body: null });

        const res = await pending;
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(await res.text()).toBe('fresh');
      });

      testWithRLS('a cached error is consumed: the next fetch goes to nativeFetch', async () => {
        Fetch.clientInit({
          [URL]: [{
            aux: { method: 'GET', query: '', body: null },
            data: { response: null, error: { name: 'Error', message: 'server boom' }, requesters: 1 },
          }],
        });

        await expect(Fetch.fetch(URL)).rejects.toThrow('server boom');
        expect(mockFetch).not.toHaveBeenCalled();

        mockFetch.mockResolvedValue(new Response('fresh', { headers: { 'Content-Type': 'text/plain' } }));
        const res = await Fetch.fetch(URL);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(await res.text()).toBe('fresh');
      });

      testWithRLS('URL absent from the rehydrated cache falls through to nativeFetch', async () => {
        mockFetch.mockResolvedValue(new Response('miss', { headers: { 'Content-Type': 'text/plain' } }));
        Fetch.clientInit(dehydratedWith(1));
        await Fetch.fetch('https://api.example.com/other');
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      testWithRLS('post-hydration (clientInit with no payload) goes straight to nativeFetch', async () => {
        mockFetch.mockResolvedValue(new Response('live', { headers: { 'Content-Type': 'text/plain' } }));
        Fetch.clientInit();
        await Fetch.fetch(URL);
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });
  });
});
