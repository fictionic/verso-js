import { getNamespace } from '../util/requestLocal';

const nativeFetch = globalThis.fetch;

export interface CachedResponse {
  text: string;
  status: number;
  headers: [string, string][];
}

export interface CacheEntry {
  response: CachedResponse | null;
  requesters: number;
}

// --- Request-scoped state (per-request on server, singleton on client) ---

const RLS = getNamespace<{
  cache: Map<string, CacheEntry>;
  pending: Map<string, Promise<void>>;
  urlPrefix: string;
}>();

export function setUrlPrefix(prefix: string): void {
  RLS().urlPrefix = prefix;
}

function cache(): Map<string, CacheEntry> {
  if (!RLS().cache) RLS().cache = new Map();
  return RLS().cache;
}

function pending(): Map<string, Promise<void>> {
  if (!RLS().pending) RLS().pending = new Map();
  return RLS().pending;
}

export function getCache(): Map<string, CacheEntry> {
  return cache();
}

export function getPendingRequests(): Array<{ url: string; promise: Promise<void> }> {
  return [...pending().entries()].map(([url, promise]) => ({ url, promise }));
}

function resolveUrl(url: string): string {
  if (url.startsWith('/')) {
    const prefix = RLS().urlPrefix ?? '';
    return prefix ? prefix + url : url;
  }
  return url;
}

function responseFromEntry(entry: CacheEntry): Response {
  const { response } = entry;
  if (!response) throw new Error('fetch: cache entry has no response data');
  return new Response(response.text, {
    status: response.status,
    headers: response.headers,
  });
}

// --- Client-side: deferred resolution for late arrivals ---

const _clientPending = new Map<string, { promise: Promise<CacheEntry>; resolve: (entry: CacheEntry) => void }>();

export function receiveLateDataArrival(url: string, entry: CacheEntry): void {
  const c = cache();
  const existing = c.get(url);
  const requesters = existing?.requesters ?? entry.requesters;
  c.set(url, { ...entry, requesters });
  const p = _clientPending.get(url);
  if (p) {
    p.resolve(entry);
    _clientPending.delete(url);
  }
}

// --- Shared ---

export function dehydrateCache(): Record<string, CacheEntry> {
  const obj: Record<string, CacheEntry> = {};
  for (const [key, entry] of cache()) {
    obj[key] = entry;
  }
  for (const url of pending().keys()) {
    if (!obj[url]) {
      obj[url] = { response: null, requesters: 0 };
    }
  }
  return obj;
}

export function rehydrateCache(data: Record<string, CacheEntry>): void {
  const c = cache();
  for (const [key, entry] of Object.entries(data)) {
    c.set(key, entry);
    if (!entry.response) {
      let resolve!: (entry: CacheEntry) => void;
      const promise = new Promise<CacheEntry>(r => { resolve = r; });
      _clientPending.set(key, { promise, resolve });
    }
  }
}

function consume(url: string): void {
  const c = cache();
  const entry = c.get(url);
  if (!entry) return;
  entry.requesters--;
  if (entry.requesters <= 0) c.delete(url);
}

export function fetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();

  // Non-GET requests: no caching, just apply urlPrefix and pass through
  if (method !== 'GET') {
    return nativeFetch(resolveUrl(url), init);
  }

  const c = cache();
  const existing = c.get(url);
  if (existing) {
    if (existing.response) {
      const res = responseFromEntry(existing);
      consume(url);
      return Promise.resolve(res);
    }
    // Entry exists but not loaded — waiting for late data arrival (client-side)
    const deferred = _clientPending.get(url);
    if (deferred) {
      return deferred.promise.then((entry) => {
        const res = responseFromEntry(entry);
        consume(url);
        return res;
      });
    }
  }

  const p = pending();
  if (p.has(url)) {
    // Server-side: another caller already initiated this fetch
    const entry = c.get(url);
    if (entry) entry.requesters++;
    return p.get(url)!.then(() => {
      const entry = c.get(url);
      if (!entry) throw new Error(`fetch: cache entry missing for deduplicated request ${url}`);
      const res = responseFromEntry(entry);
      consume(url);
      return res;
    });
  }

  const promise = (async () => {
    const res = await nativeFetch(resolveUrl(url), init);
    const text = await res.text();
    c.set(url, {
      response: {
        text,
        status: res.status,
        headers: [...res.headers.entries()],
      },
      requesters: 1,
    });
    p.delete(url);
  })();

  p.set(url, promise);
  return promise.then(() => {
    const entry = c.get(url);
    if (!entry) throw new Error(`fetch: cache entry missing after fetch for ${url}`);
    const res = responseFromEntry(entry);
    consume(url);
    return res;
  });
}
