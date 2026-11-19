import {exhaustive} from "../../../util/invariant";
import {marshallBody, unmarshallBody, type MarshalledBody} from "../util/body";

export type DehydratedCache = Record<string, Array<DehydratedCacheEntry>>;

export type CacheableRequest = {
  url: string;
  method: string;
  body: string | null;
};

export type CacheEntryData = {
  response: CachedResponse | null;
  error: MarshalledError | null;
  requesters: number;
};

type CachedResponse = {
  body: MarshalledBody | null;
  status: number;
  // we don't include response headers in the cache because (1) they're big, (2)
  // it would be a security vulnerability, and (3) probably no one needs them.
};

type MarshalledError = {
  name: string;
  message: string;
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

type BaseEviction = { kind: 'eviction' };

type CacheEntry<Eviction extends BaseEviction = BaseEviction> = {
  aux: CacheKeyAuxData;
  data: CacheEntryData;
  dfd: PromiseWithResolvers<CacheEntryResult<Eviction>>;
  evicted?: boolean;
};

// evictions on the server come back with the raw response, but on the client
// the response is not available, because it wasn't transported
type CacheEntryResult<Eviction extends BaseEviction = BaseEviction> = {
  kind: 'cachedResponse';
  cachedResponse: CachedResponse;
} | Eviction;

abstract class FetchCache<Eviction extends BaseEviction = BaseEviction> {
  protected buckets: Map<string, Array<CacheEntry<Eviction>>>;

  constructor() {
    this.buckets = new Map();
  }

  protected ensureEntry(entry: CacheEntry<Eviction> | null): CacheEntry<Eviction> {
    // TODO: better error message
    if (!entry) throw new Error("cache entry not found!");
    return entry;
  }

  protected createEntry(req: CacheableRequest): CacheEntry<Eviction> {
    const { urlKey, searchParams } = parseUrlString(req.url);
    const entry: CacheEntry<Eviction> = {
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
    const key = urlKey;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(entry);
    return entry;
  }

  protected findEntry(req: CacheableRequest): CacheEntry<Eviction> | null {
    const { urlKey, searchParams } = parseUrlString(req.url);
    const bucket = this.buckets.get(urlKey);
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

  protected evictRequest(req: CacheableRequest, eviction: Eviction) {
    const entry = this.findEntry(req);
    if (!entry) return;
    entry.evicted = true;
    entry.dfd.resolve(eviction);
  }
}

type ServerEviction = {
  kind: 'eviction';
  rawResponse: Response;
};

export type PendingServerEntry = {
  request: CacheableRequest;
  resultPromise: Promise<PendingServerEntryResult>;
};

type PendingServerEntryResult = {
  kind: 'data';
  data: CacheEntryData;
} | ServerEviction;

type ReceivedServerRequest = {
  hit: boolean;
  // on the server, a cache miss will still end up resolving through the cache,
  // because that's how the client will get it, and we need these to match.
  responsePromise: Promise<Response>;
};

export class FetchServerCache extends FetchCache<ServerEviction> {
  receiveRequest(req: CacheableRequest): ReceivedServerRequest {
    let hit!: boolean;
    let entry = this.findEntry(req);
    if (!entry) {
      hit = false;
      entry = this.createEntry(req);
    } else {
      hit = true;
      entry.data.requesters += 1;
    }
    return {
      hit,
      responsePromise: entry.dfd.promise.then((result) => {
        switch (result.kind) {
          case 'cachedResponse':
            return readCachedResponse(result.cachedResponse);
          case 'eviction':
            // clone the raw response in case there are parallel requesters
            return result.rawResponse.clone();
          default:
            exhaustive(result);
        }
      }),
    };
  }

  async receiveResponse(req: CacheableRequest, response: Response) {
    const entry = this.ensureEntry(this.findEntry(req));
    const cachedResponse: CachedResponse = {
      body: await marshallBody(response),
      status: response.status,
    };
    entry.data.response = cachedResponse;
    entry.dfd.resolve({ kind: 'cachedResponse', cachedResponse });
  }

  receiveError(req: CacheableRequest, error: Error) {
    const entry = this.ensureEntry(this.findEntry(req));
    // on the server, reject with the actual error
    // TODO: this is non-isomorphic. if the app's render branches on the name of
    // the Error object, it can lead to mismatches. do I care?
    entry.dfd.reject(error);
    entry.data.error = marshallError(error);
  }

  receiveUnmarshallableResponse(req: CacheableRequest, response: Response) {
    this.evictRequest(req, { kind: 'eviction', rawResponse: response })
  }

  dehydrate(): DehydratedCache {
    const dehydrated: DehydratedCache = {};
    this.buckets.forEach((entries, urlKey) => {
      const dehydratedEntries = entries
        .filter((entry) => !entry.evicted)
        .map((entry) => ({
          aux: entry.aux,
          data: entry.data,
        }));
      if (dehydratedEntries.length) dehydrated[urlKey] = dehydratedEntries;
    });
    return dehydrated;
  }

  getPending(): Array<PendingServerEntry> {
    const pending: Array<PendingServerEntry> = [];
    this.buckets.forEach((entries, urlKey) => {
      entries.forEach((entry) => {
        if (entry.evicted) return;
        const { response, error } = entry.data;
        if (response || error) return;
        const { query: queryParams } = entry.aux;
        const queryString = queryParams ? `?${queryParams}` : '';
        pending.push({
          request: {
            url: urlKey + queryString,
            method: entry.aux.method,
            body: entry.aux.body,
          },
          resultPromise: entry.dfd.promise
            .then(
              (result) => {
                switch (result.kind) {
                  case 'cachedResponse':
                    return {
                      kind: 'data',
                      data: entry.data,
                    };
                  case 'eviction':
                    return result;
                  default:
                    exhaustive(result);
                }
              },
            (_err) => {
              // the info about the error is contained within the entry data; we
              // send it down in the same way as a successful response.
              return {
                kind: 'data',
                data: entry.data,
              };
            },
          ),
        });
      });
    });
    return pending;
  }
}

// requests that are evicted after hydration has started can't include the raw
// response, because they can't be transported to the client
type ClientEviction = BaseEviction;

type ReceivedClientRequest = {
  kind: 'hit';
  resultPromise: Promise<{
    kind: 'response';
    response: Response;
  } | ClientEviction>;
} | {
  kind: 'miss';
  // on the client, a cache miss doesn't resolve through the cache
};

export class FetchClientCache extends FetchCache {
  rehydrate(dehydrated: DehydratedCache) {
    Object.entries(dehydrated).forEach(([urlKey, dehydratedEntries]) => {
      const rehydratedEntries: CacheEntry[] = dehydratedEntries.map((dehydratedEntry) => {
        const dfd = Promise.withResolvers<CacheEntryResult>();
        const { response: cachedResponse, error } = dehydratedEntry.data;
        if (error) {
          // on the client, reject with a reconstructed version of the original
          // error from the server
          dfd.reject(unmarshallError(error));
        } else if (cachedResponse) {
          dfd.resolve({ kind: 'cachedResponse', cachedResponse });
        }
        return {
          aux: dehydratedEntry.aux,
          data: dehydratedEntry.data,
          dfd,
        };
      });
      this.buckets.set(urlKey, rehydratedEntries);
    });
  }

  receiveRequest(req: CacheableRequest): ReceivedClientRequest {
    const entry = this.findEntry(req);
    if (!entry) return { kind: 'miss' };
    return {
      kind: 'hit',
      resultPromise: entry.dfd.promise.then((result) => {
        switch (result.kind) {
          case 'cachedResponse':
            return {
              kind: 'response',
              response: readCachedResponse(result.cachedResponse),
            };
          case 'eviction':
            return result;
          default:
            exhaustive(result);
        }
      }),
    };
  }

  // this method is passed by reference and needs `this` bound properly
  receiveLateArrivalData = (req: CacheableRequest, data: CacheEntryData) => {
    const entry = this.ensureEntry(this.findEntry(req));
    entry.data = data;
    if (data.error) {
      entry.dfd.reject(unmarshallError(data.error));
    } else {
      // TODO is this nonnull assertion safe?
      entry.dfd.resolve({ kind: 'cachedResponse', cachedResponse: data.response! });
    }
  }

  // this method is passed by reference and needs `this` bound properly
  receiveLateArrivalEviction = (req: CacheableRequest) => {
    this.evictRequest(req, { kind: 'eviction' })
  }

  consumeResponse(req: CacheableRequest) {
    const entry = this.findEntry(req);
    if (!entry) return;
    entry.data.requesters -= 1;
    if (entry.data.requesters <= 0) {
      entry.evicted = true;
    }
  }
}

type ParsedURL = {
  urlKey: string;
  searchParams: URLSearchParams;
};

function parseUrlString(url: string): ParsedURL {
  const [urlKey, queryString] = url.split('?', 2);
  const searchParams = new URLSearchParams(queryString);
  return {
    urlKey: urlKey!,
    searchParams,
  };
}

function normalizeQueryParams(_params: URLSearchParams): string {
  const params = new URLSearchParams(_params);
  params.sort();
  return params.toString();
}

function readCachedResponse(cachedResponse: CachedResponse): Response {
  const body = unmarshallBody(cachedResponse.body);
  return new Response(body, {
    status: cachedResponse.status,
  });
}

function marshallError(error: Error): MarshalledError {
  return {
    name: error.name,
    message: error.message,
  };
}

function unmarshallError(error: MarshalledError): ReconstructedFetchError {
  return new ReconstructedFetchError(error);
}

class ReconstructedFetchError extends Error {
  constructor(error: MarshalledError) {
    super(error.message);
    this.name = error.name;
  }
}
