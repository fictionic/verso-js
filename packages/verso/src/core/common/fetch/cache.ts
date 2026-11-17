import {marshallBody, unmarshallBody, type MarshalledBody} from "../util/body";

export type DehydratedCache = Record<string, Array<DehydratedCacheEntry>>;

export type PendingEntry = {
  request: CacheableRequest;
  dataPromise: Promise<CacheEntryData>;
};

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

abstract class FetchCache {
  protected buckets: Map<string, Array<CacheEntry>>;

  constructor() {
    this.buckets = new Map();
  }

  protected ensureEntry(entry: CacheEntry | null): CacheEntry {
    // TODO: better error message
    if (!entry) throw new Error("cache entry not found!");
    return entry;
  }

  protected createEntry(req: CacheableRequest): CacheEntry {
    const { urlKey, searchParams } = parseUrlString(req.url);
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
    const key = urlKey;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(entry);
    return entry;
  }

  protected findEntry(req: CacheableRequest): CacheEntry | null {
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

}

type ReceivedRequest = {
  first: boolean; // the caller needs different behavior on an initial request
  responsePromise: Promise<Response>;
};

export class FetchServerCache extends FetchCache {
  receiveRequest(req: CacheableRequest): ReceivedRequest {
    let first!: boolean;
    let entry = this.findEntry(req);
    if (!entry) {
      first = true;
      entry = this.createEntry(req);
    } else {
      first = false;
      entry.data.requesters += 1;
    }
    return {
      first,
      responsePromise: reifyCachedResponse(entry.dfd.promise),
    };
  }

  async receiveResponse(req: CacheableRequest, response: Response) {
    const entry = this.ensureEntry(this.findEntry(req));
    const cachedResponse: CachedResponse = {
      body: await marshallBody(response),
      status: response.status,
    };
    entry.data.response = cachedResponse;
    entry.dfd.resolve(cachedResponse);
  }

  receiveError(req: CacheableRequest, error: Error) {
    const entry = this.ensureEntry(this.findEntry(req));
    entry.dfd.reject(error);
    entry.data.error = marshallError(error);
  }

  evictRequest(req: CacheableRequest, response: Response) {
    const entry = this.findEntry(req);
    if (!entry) return;
    entry.evicted = true;
    entry.dfd.reject({
      [EVICTED]: true,
      response,
    });
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

  getPending(): Array<PendingEntry> {
    const pending: Array<PendingEntry> = [];
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
          dataPromise: entry.dfd.promise
            .then(
              () => entry.data,
              () => entry.data
            ),
        });
      });
    });
    return pending;
  }
}

export class FetchClientCache extends FetchCache {
  rehydrate(dehydrated: DehydratedCache) {
    Object.entries(dehydrated).forEach(([urlKey, dehydratedEntries]) => {
      const rehydratedEntries: CacheEntry[] = dehydratedEntries.map((dehydratedEntry) => {
        const dfd = Promise.withResolvers<CachedResponse>();
        const { response, error } = dehydratedEntry.data;
        if (response) {
          dfd.resolve(response);
        } else if (error) {
          dfd.reject(unmarshallError(error));
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

  receiveRequest(req: CacheableRequest): Promise<Response> | null {
    const entry = this.findEntry(req);
    if (!entry) return null;
    return reifyCachedResponse(entry.dfd.promise);
  }

  // this method is passed by reference and needs `this` bound properly
  receiveLateArrivalData = (req: CacheableRequest, data: CacheEntryData) => {
    const entry = this.ensureEntry(this.findEntry(req));
    entry.data = data;
    if (data.response) {
      entry.dfd.resolve(data.response);
    } else {
      // TODO: what if there's no response but also no error?
      // we should probably use the truthiness of 'error' rather than 'response'
      entry.dfd.reject(unmarshallError(data.error!));
    }
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

function reifyCachedResponse(promise: Promise<CachedResponse>): Promise<Response> {
  return promise.then(readCachedResponse, extractEvictedResponse);
}

function readCachedResponse(cachedResponse: CachedResponse): Response {
  const body = unmarshallBody(cachedResponse.body);
  return new Response(body, {
    status: cachedResponse.status,
  });
}

function extractEvictedResponse(thrown: unknown): Response {
  if (typeof thrown === 'object' && thrown !== null && EVICTED in thrown) {
    // response bodies can only be consumed once. have to clone
    // in case there are multiple requesters
    return (thrown as ThrownEviction).response.clone();
  }
  throw thrown;
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
