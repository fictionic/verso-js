declare const SERVER_SIDE: boolean;
import { getNamespace } from '../../util/requestLocal';
import { FetchCache, type CachedResponse } from './cache';
import { nativeFetch } from './nativeFetch';

const RLS = getNamespace<{
  cache: FetchCache;
  urlPrefix: string | null;
}>();

// the sluice-facing interface
export const Fetch = {
  serverInit,
  clientInit,
  getCache,
  fetch,
};

function serverInit(urlPrefix: string) {
  RLS().urlPrefix = urlPrefix;
  RLS().cache = new FetchCache();
}

function clientInit() {
  RLS().cache = new FetchCache();
}

function getCache() {
  return RLS().cache;
}

function fetch(url: string, init?: RequestInit): Promise<Response> {
  // TODO: strip out stuff from the request that isn't isomorphic or that we don't need
  // (see RSA)
  const method = (init?.method ?? 'GET').toUpperCase();

  const doNativeFetch = () => nativeFetch(resolveUrl(url), init);

  // only transport GET requests
  // TODO: allow overriding this per-request
  if (method !== 'GET') {
    return doNativeFetch();
  }

  if (SERVER_SIDE) {
    const cache = getCache().server();
    const { first, promise } = cache.receiveRequest(url);
    if (first) {
      // make the request and cache the response for transport
      doNativeFetch().then((res) => {
        cache.receiveResponse(url, res);
      }, (error) => {
        cache.receiveError(url, error);
      });
    }
    // wait for the response (either created just now, or pulled from cache)
    return promise.then(reifyCachedResponse);
  } else {
    // CLIENT_SIDE
    const cache = getCache().client();
    const responsePromise = cache.receiveRequest(url);
    if (responsePromise) {
      // cache hit: replay the response and consume
      return responsePromise.then((cachedResponse) => {
        cache.consumeResponse(url);
        return reifyCachedResponse(cachedResponse);
      }, (message) => {
        cache.consumeResponse(url);
        throw new Error(message);
      });
    } else {
      // either we're post-hydration, or the client made a non-isomorphic request.
      // either way, all we can do is pass through
      return doNativeFetch();
    }
  }

}

function resolveUrl(url: string): string {
  if (url.startsWith('/')) {
    const prefix = RLS().urlPrefix ?? '';
    return prefix ? prefix + url : url;
  }
  return url;
}

function reifyCachedResponse(r: CachedResponse): Response {
  return new Response(r.text, {
    status: r.status,
    // headers: r.headers, // TODO will anyone want response headers? they're big to serialize
  });
}

