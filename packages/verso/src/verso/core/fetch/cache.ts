export interface CachedResponse {
  text: string;
  status: number;
  headers: [string, string][];
}

export interface CacheEntry {
  response: CachedResponse | null;
  errorMessage: string | null;
  requesters: number;
}

export class FetchCache {
  private data: Record<string, CacheEntry>; // serializable data to be transported
  private pending: Record<string, PromiseWithResolvers<CachedResponse>>;

  constructor() {
    this.data = {};
    this.pending = {};
  }

  server() {
    const cache = this;
    return {
      receiveRequest(url: string): {first: boolean, promise: Promise<CachedResponse>} {
        let first = true;
        if (!cache.data[url]) {
          cache.data[url] = {
            response: null,
            errorMessage: null,
            requesters: 1,
          };
          cache.pending[url] = Promise.withResolvers();
        } else {
          first = false;
          cache.data[url].requesters += 1;
        }
        return {
          first,
          promise: cache.pending[url]!.promise,
        };
      },

      async receiveResponse(url: string, response: Response) {
        if (!cache.data[url] || !cache.pending[url]) {
          console.error(`no cache entry for url ${url}`);
          return Promise.reject();
        }
        const text = await response.text();
        const cachedResponse = {
          text,
          status: response.status,
          headers: [...response.headers.entries()],
        };
        cache.data[url].response = cachedResponse;
        cache.pending[url].resolve(cachedResponse);
      },

      receiveError(url: string, error: Error) {
        if (!cache.data[url] || !cache.pending[url]) {
          const e = new Error(`no cache entry for url ${url}`);
          console.error(e);
          return Promise.reject(e);
        }
        cache.pending[url].reject(error);
        cache.data[url].errorMessage = error.message;
      },

      dehydrate() {
        return cache.data;
      },

      getPending() {
        return Object.entries(cache.pending)
          .filter(([url]) => {
            const data = cache.data[url];
            if (!data) {
              console.error(`no cache entry for url ${url}`);
              return false;
            }
            return !data.response && !data.errorMessage;
          })
          .map(([url, dfd]) => ({
            url,
            promise: dfd.promise,
          }));
      }
    }
  }

  client() {
    const cache = this;
    return {
      rehydrate(data: typeof cache.data) {
        Object.entries(data).forEach(([url, entry]) => {
          cache.data[url] = entry;
          cache.pending[url] = Promise.withResolvers();
          if (entry.response) {
            cache.pending[url].resolve(entry.response);
          } else if (entry.errorMessage) {
            cache.pending[url].reject(new Error(entry.errorMessage));
          }
        });
      },

      receiveRequest(url: string): Promise<CachedResponse> | null {
        return cache.pending[url]?.promise ?? null;
      },

      receiveCachedResponse(url: string, response: CachedResponse) {
        if (!cache.data[url] || !cache.pending[url]) {
          console.error(`no cache entry for url ${url}`);
          return;
        }
        cache.data[url].response = response;
        cache.pending[url].resolve(response);
      },

      consumeResponse(url: string) {
        const entry = cache.data[url];
        if (!entry) {
          console.error(`no cache entry for url ${url}`);
          return;
        }
        entry.requesters -= 1;
        if (entry.requesters <= 0) {
          delete cache.data[url];
          delete cache.pending[url];
        }
      }
    }
  }
}

