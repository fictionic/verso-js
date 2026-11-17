import { describe, test, expect } from 'vitest';
import { FetchClientCache, FetchServerCache } from '../core/common/fetch/cache';
import type { CacheableRequest, DehydratedCache } from '../core/common/fetch/cache';
import { serverSide, clientSide } from '../userland/testing/isomorphic';

const URL = 'https://api.example.com/data';

describe('FetchCache', () => {
  serverSide(() => {
    test('receiveRequest -> receiveResponse -> dehydrate produces correct serialized format', async () => {
      const server = new FetchServerCache();
      const req: CacheableRequest = { url: URL, method: 'GET', body: null };

      const { first, responsePromise } = server.receiveRequest(req);
      expect(first).toBe(true);

      await server.receiveResponse(req, new Response('{"hello":"world"}', { status: 200 }));

      const dehydrated = server.dehydrate();
      expect(dehydrated).toEqual({
        [URL]: [{
          aux: { method: 'GET', query: '', body: null },
          data: { response: { body: { text: '{"hello":"world"}', }, status: 200 }, error: null, requesters: 1 },
        }],
      });

      const response = await responsePromise;
      expect(await response.text()).toBe('{"hello":"world"}');
      expect(response.status).toBe(200);
    });

    test('receiveRequest twice for same key: first true then false, requesters is 2', () => {
      const server = new FetchServerCache();
      const req: CacheableRequest = { url: URL, method: 'GET', body: null };

      const result1 = server.receiveRequest(req);
      expect(result1.first).toBe(true);

      const result2 = server.receiveRequest(req);
      expect(result2.first).toBe(false);

      const dehydrated = server.dehydrate();
      expect(dehydrated[URL]![0]!.data.requesters).toBe(2);
    });

    test('evictRequest marks entry evicted; dehydrate excludes it', async () => {
      const server = new FetchServerCache();
      const req: CacheableRequest = { url: URL, method: 'GET', body: null };

      const { responsePromise } = server.receiveRequest(req);

      server.evictRequest(req, new Response('evicted', { status: 200 }));

      const dehydrated = server.dehydrate();
      expect(Object.keys(dehydrated)).toHaveLength(0);

      await responsePromise;
    });

    test('evictRequest resolves responsePromise with a clone of the evicted response', async () => {
      const server = new FetchServerCache();
      const req: CacheableRequest = { url: 'https://api.example.com/eviction-test', method: 'GET', body: null };
      const { responsePromise } = server.receiveRequest(req);

      server.evictRequest(req, new Response('evicted body', { status: 301 }));

      const result = await responsePromise;
      expect(result.status).toBe(301);
      expect(await result.text()).toBe('evicted body');
    });

    test('receiveError stores error message (not Error object)', async () => {
      const server = new FetchServerCache();
      const req: CacheableRequest = { url: URL, method: 'GET', body: null };

      const { responsePromise } = server.receiveRequest(req);
      server.receiveError(req, new Error('network failure'));

      await expect(responsePromise).rejects.toThrow('network failure');

      const dehydrated = server.dehydrate();
      const entry = dehydrated[URL]![0]!;
      expect(entry.data.error).toEqual({ name: 'Error', message: 'network failure' });
      expect(entry.data.error).not.toBeInstanceOf(Error);
    });

    test('getPending returns entries with no response/error, skips evicted', async () => {
      const server = new FetchServerCache();
      const reqPending: CacheableRequest = { url: 'https://api.example.com/a', method: 'GET', body: null };
      const reqEvicted: CacheableRequest = { url: 'https://api.example.com/b', method: 'GET', body: null };
      const reqResolved: CacheableRequest = { url: 'https://api.example.com/c', method: 'GET', body: null };

      server.receiveRequest(reqPending);
      server.receiveRequest(reqEvicted);
      server.receiveRequest(reqResolved);

      server.evictRequest(reqEvicted, new Response('evicted', { status: 200 }));

      await server.receiveResponse(reqResolved, new Response('data', { status: 200 }));

      const pending = server.getPending();
      expect(pending).toHaveLength(1);
      const pendingEntry = pending[0]!;
      expect(pendingEntry.request.url).toBe('https://api.example.com/a');
      expect(pendingEntry.request.method).toBe('GET');
      expect(pendingEntry.request.body).toBeNull();
    });
  });

  clientSide(() => {
    test('rehydrate with response resolves dfd', async () => {
      const client = new FetchClientCache();

      const dehydrated: DehydratedCache = {
        [URL]: [{
          aux: { method: 'GET', query: '', body: null },
          data: { response: { body: { text: '{"hello":"world"}' }, status: 200 }, error: null, requesters: 1 },
        }],
      };
      client.rehydrate(dehydrated);

      const req: CacheableRequest = { url: URL, method: 'GET', body: null };
      const promise = client.receiveRequest(req);
      expect(promise).not.toBeNull();

      const response = await promise!;
      expect(await response.text()).toBe('{"hello":"world"}');
      expect(response.status).toBe(200);
    });

    test('rehydrate with error rejects dfd', async () => {
      const client = new FetchClientCache();

      const dehydrated: DehydratedCache = {
        [URL]: [{
          aux: { method: 'GET', query: '', body: null },
          data: { response: null, error: { name: 'Error', message: 'network failure' }, requesters: 1 },
        }],
      };
      client.rehydrate(dehydrated);

      const req: CacheableRequest = { url: URL, method: 'GET', body: null };
      const promise = client.receiveRequest(req);
      expect(promise).not.toBeNull();

      await expect(promise!).rejects.toThrow('network failure');
    });

    test('consumeResponse decrements requesters; evicts at 0', () => {
      const client = new FetchClientCache();

      const dehydrated: DehydratedCache = {
        [URL]: [{
          aux: { method: 'GET', query: '', body: null },
          data: { response: { body: { text: 'data' }, status: 200 }, error: null, requesters: 2 },
        }],
      };
      client.rehydrate(dehydrated);

      const req: CacheableRequest = { url: URL, method: 'GET', body: null };

      client.consumeResponse(req);
      expect(client.receiveRequest(req)).not.toBeNull();

      client.consumeResponse(req);
      expect(client.receiveRequest(req)).toBeNull();
    });

    test('receiveRequest returns null for unknown key (cache miss)', () => {
      const client = new FetchClientCache();

      const req: CacheableRequest = { url: 'https://api.example.com/unknown', method: 'GET', body: null };
      expect(client.receiveRequest(req)).toBeNull();
    });
  });

  describe('shared', () => {
    test('query param normalization: ?b=2&a=1 and ?a=1&b=2 produce same key', () => {
      const server = new FetchServerCache();

      const req1: CacheableRequest = { url: 'https://api.example.com/data?b=2&a=1', method: 'GET', body: null };
      const req2: CacheableRequest = { url: 'https://api.example.com/data?a=1&b=2', method: 'GET', body: null };

      const result1 = server.receiveRequest(req1);
      expect(result1.first).toBe(true);

      const result2 = server.receiveRequest(req2);
      expect(result2.first).toBe(false);

      const dehydrated = server.dehydrate();
      expect(dehydrated[URL]).toHaveLength(1);
      expect(dehydrated[URL]![0]!.data.requesters).toBe(2);
    });

    test('rehydrated binary (base64) body decodes correctly', async () => {
      const originalBytes = new Uint8Array([1, 2, 3, 4, 5]);
      const client = new FetchClientCache();

      client.rehydrate({
        [URL]: [{
          aux: { method: 'GET', query: '', body: null },
          data: { response: { body: { text: originalBytes.toBase64(), isBinary: true }, status: 200 }, error: null, requesters: 1 },
        }],
      });

      const response = await client.receiveRequest({ url: URL, method: 'GET', body: null })!;
      expect(response.status).toBe(200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes).toEqual(originalBytes);
    });
  });
});
