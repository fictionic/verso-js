export type DehydratedCache = Record<string, Array<DehydratedCacheEntry>>;

export type PendingEntry = {
  request: CacheableRequest;
  promise: Promise<CachedResponse>;
};

export type CacheableRequest = {
  url: string;
  method: string;
  body: string | null;
};

export type CachedResponse = {
  text: string;
  isBinary?: boolean;
  status: number;
  // we don't include response headers in the cache because (1) they're big,
  // (2) it would be a security vulnerability, and (3) probably no one needs them.
};

type DehydratedCacheEntry = {
  aux: CacheKeyAuxData;
  data: CacheEntryData;
};

type CacheKeyAuxData = {
  method: string;
  query: string;
  body: string | null;
};

type CacheEntryData = {
  response: CachedResponse | null;
  error: { message: string } | null;
  requesters: number;
};

type CacheEntry = {
  aux: CacheKeyAuxData;
  data: CacheEntryData;
  dfd: PromiseWithResolvers<CachedResponse>;
  evicted?: boolean;
};

const EVICTED: unique symbol = Symbol();

type ThrownEviction = {
  [EVICTED]: true,
  response: Response,
};

export class FetchCache {
  private buckets: Map<string, Array<CacheEntry>>;

  constructor() {
    this.buckets = new Map();
  }

  private createEntry(req: CacheableRequest): CacheEntry {
    const { hostAndPath, searchParams } = parseUrlString(req.url);
    const entry: CacheEntry = {
      data: {
        response: null,
        error: null,
        requesters: 1,
      },
      aux: {
        method: req.method,
        body: req.body,
        query: normalizeQueryParams(searchParams),
      },
      dfd: Promise.withResolvers(),
    };
    const key = hostAndPath;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(entry);
    return entry;
  }

  private findEntry(req: CacheableRequest): CacheEntry | null {
    const { hostAndPath, searchParams } = parseUrlString(req.url);
    const bucket = this.buckets.get(hostAndPath);
    if (!bucket) return null;
    const normalizedParams = normalizeQueryParams(searchParams);
    return bucket.find((entry) => {
      if (entry.evicted) return false;
      const { method, query, body } = entry.aux;
      if (method !== req.method) return false;
      if (normalizedParams !== query) return false;
      if (body !== req.body) return false;
      return true;
    }) ?? null;
  }

  server() {
    const cache = this;
    return {
      receiveRequest(req: CacheableRequest): {first: boolean, responsePromise: Promise<CachedResponse>} {
        let first!: boolean;
        let entry = cache.findEntry(req);
        if (!entry) {
          first = true;
          entry = cache.createEntry(req);
        } else {
          first = false;
          entry.data.requesters += 1;
        }
        return {
          first,
          responsePromise: entry.dfd.promise,
        };
      },

      async receiveResponse(req: CacheableRequest, response: Response) {
        const entry = ensureEntry(cache.findEntry(req));
        const text = await response.text();
        const cachedResponse: CachedResponse = {
          text,
          status: response.status,
        };
        entry.data.response = cachedResponse;
        entry.dfd.resolve(cachedResponse);
      },

      async receiveBinaryResponse(req: CacheableRequest, response: Response) {
        const entry = ensureEntry(cache.findEntry(req));
        const bytes = await response.bytes();
        const cachedResponse: CachedResponse = {
          text: bytes.toBase64(),
          isBinary: true,
          status: response.status,
        };
        entry.data.response = cachedResponse;
        entry.dfd.resolve(cachedResponse);
      },

      evictRequest(req: CacheableRequest, response: Response) {
        const entry = cache.findEntry(req);
        if (!entry) return;
        entry.evicted = true;
        entry.dfd.reject({
          [EVICTED]: true,
          response,
        });
      },

      receiveError(req: CacheableRequest, error: Error) {
        const entry = ensureEntry(cache.findEntry(req));
        entry.dfd.reject(error);
        // Error objects aren't serializable
        entry.data.error = { message: error.message };
      },

      dehydrate(): DehydratedCache {
        const dehydrated: DehydratedCache = {};
        cache.buckets.forEach((entries, hostAndPath) => {
          const dehydratedEntries = entries
            .filter((entry) => !entry.evicted)
            .map((entry) => ({
              aux: entry.aux,
              data: entry.data,
            }));
          if (dehydratedEntries.length) dehydrated[hostAndPath] = dehydratedEntries;
        });
        return dehydrated;
      },

      getPending(): Array<PendingEntry> {
        const pending: Array<PendingEntry> = [];
        cache.buckets.forEach((entries, hostAndPath) => {
          entries.forEach((entry) => {
            if (entry.evicted) return;
            const { response, error } = entry.data;
            if (response || error) return;
            const { query: queryParams } = entry.aux;
            const queryString = queryParams ? `?${queryParams}` : '';
            pending.push({
              request: {
                url: hostAndPath + queryString,
                method: entry.aux.method,
                body: entry.aux.body,
              },
              promise: entry.dfd.promise,
            });
          });
        });
        return pending;
      }
    }
  }

  client() {
    const cache = this;
    return {
      rehydrate(dehydrated: DehydratedCache) {
        Object.entries(dehydrated).forEach(([hostAndPath, dehydratedEntries]) => {
          const rehydratedEntries: CacheEntry[] = dehydratedEntries.map((dehydratedEntry) => {
            const dfd = Promise.withResolvers<CachedResponse>();
            const { response, error } = dehydratedEntry.data;
            if (response) {
              dfd.resolve(response);
            } else if (error) {
              dfd.reject(new Error(error.message));
            }
            return {
              aux: dehydratedEntry.aux,
              data: dehydratedEntry.data,
              dfd,
            };
          });
          cache.buckets.set(hostAndPath, rehydratedEntries);
        });
      },

      receiveRequest(req: CacheableRequest): Promise<CachedResponse> | null {
        return cache.findEntry(req)?.dfd.promise ?? null;
      },

      receiveCachedResponse(req: CacheableRequest, response: CachedResponse) {
        const entry = ensureEntry(cache.findEntry(req));
        entry.data.response = response;
        entry.dfd.resolve(response);
      },

      consumeResponse(req: CacheableRequest) {
        const entry = cache.findEntry(req);
        if (!entry) return;
        entry.data.requesters -= 1;
        if (entry.data.requesters <= 0) {
          entry.evicted = true;
        }
      }
    }
  }
}

function ensureEntry(entry: CacheEntry | null): CacheEntry {
  if (!entry) throw new Error("cache entry not found!");
  return entry;
}

type ParsedURL = {
  hostAndPath: string;
  searchParams: URLSearchParams;
};
function parseUrlString(url: string): ParsedURL {
  const [hostAndPath, queryString] = url.split('?', 2);
  const searchParams = new URLSearchParams(queryString);
  return {
    hostAndPath: hostAndPath!,
    searchParams,
  };
}

function normalizeQueryParams(params: URLSearchParams): string {
  const _params = new URLSearchParams(params);
  _params.sort();
  return _params.toString();
}

export function reifyCachedResponse(promise: Promise<CachedResponse>): Promise<Response> {
  return promise.then(readCachedResponse, extractEvictedResponse);
}

function readCachedResponse(cachedResponse: CachedResponse): Response {
  const body = cachedResponse.isBinary ? Uint8Array.fromBase64(cachedResponse.text) : cachedResponse.text;
  return new Response(body, {
    status: cachedResponse.status,
  });
}

function extractEvictedResponse(thrown: any): Response {
  if (EVICTED in thrown) {
    // response bodies can only be consumed once. have to clone
    // in case there are multiple requesters
    return (thrown as ThrownEviction).response.clone();
  }
  throw thrown;
}
