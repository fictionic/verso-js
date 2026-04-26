import type {ServerSettings} from '../../build/config';
import {ServerCookies} from '../../server/ServerCookies';
import { getRLS } from '../RequestLocalStorage';
import { FetchCache, reifyCachedResponse, type CacheableRequest } from './cache';
import { nativeFetch } from './nativeFetch';
import type { FetchRequestInterceptor, FetchRequestSettings, VersoFetchInit } from './types';

const DEFAULT_SETTINGS: Required<FetchRequestSettings> = {
  forceToCache: false,
  forceBinaryToCache: false,
  forceForwardRequestCookies: false,
  forwardResponseSetCookieHeaders: false,
};

function fillSettings(primary: FetchRequestSettings | undefined, overrides: FetchRequestSettings | undefined): Required<FetchRequestSettings> {
  return Object.assign({}, DEFAULT_SETTINGS, primary, overrides);
}

const RLS = getRLS<{
  cache: FetchCache;
  relativeUrlPrefix?: string;
  requestOrigin?: string;
  interceptor?: FetchRequestInterceptor;
}>();

// the verso-facing interface
export const Fetch = {
  serverInit,
  clientInit,
  getCache,
  fetch,
};

export function setFetchInterceptor(interceptor: FetchRequestInterceptor) {
  RLS().interceptor = interceptor;
}

function serverInit(nativeRequest: Request, serverSettings: ServerSettings) {
  RLS().requestOrigin = new URL(nativeRequest.url).origin;
  const relativeUrlPrefix = serverSettings.fetchOrigin === 'request'
    // use the Host of the page request; route through the public internet (isomorphic)
    ? RLS().requestOrigin
    // 'loopback': talk to this selfsame verso server
    : `http://localhost:${serverSettings.port}`;
  RLS().relativeUrlPrefix = relativeUrlPrefix;
  RLS().cache = new FetchCache();
}

function clientInit() {
  RLS().cache = new FetchCache();
}

function getCache() {
  return RLS().cache;
}

/**
 * Isomorphic wrapper around native fetch.
 * Intentionally only supporting url inputs because it's not worth the complexity
 * when the main use-case is for relative urls, which cannot be passed to URL or Request objects.
 */
async function fetch(rawUrl: string, rawInit: VersoFetchInit = {}, overrideSettings?: FetchRequestSettings): Promise<Response> {
  const {
    url: interceptedUrl,
    init: interceptedInit,
    settings: interceptedSettings,
  } = interceptRequest(rawUrl, rawInit);

  const {
    forceToCache,
    forceBinaryToCache,
    forceForwardRequestCookies,
    forwardResponseSetCookieHeaders,
  } = fillSettings(interceptedSettings, overrideSettings);

  // TODO: strip out stuff from the request that isn't isomorphic or that we don't need? (see RSA)

  const resolvedUrl = resolveRelativeUrl(interceptedUrl);
  const resolvedInit = resolveForwardedCookies(interceptedUrl, interceptedInit, forceForwardRequestCookies);

  const resolvedRequest = new Request(resolvedUrl, resolvedInit);
  const doNativeFetch = () => nativeFetch(resolvedRequest);

  const useCache = resolvedRequest.method === 'GET' || forceToCache;

  if (!useCache) {
    return doNativeFetch();
  }

  const req: CacheableRequest = {
    url: rawUrl,
    method: resolvedRequest.method,
    body: interceptedInit?.body ?? null,
  };

  if (globalThis.IS_SERVER) {
    const cache = getCache().server();
    const { first, responsePromise } = cache.receiveRequest(req);
    if (first) {
      try {
        // make the request
        const res = await doNativeFetch();
        if (forwardResponseSetCookieHeaders) {
          // grab set-cookie headers and attach them to the page response
          const headers = res.headers.getSetCookie();
          ServerCookies.get()!.setResponseSetCookieHeaders(headers);
        }
        if (isBinaryResponse(res)) {
          if (forceBinaryToCache) {
            // encode binary payload to base64
            cache.receiveBinaryResponse(req, res);
          } else {
            // evict from cache, reuse the response for any parallel requesters
            cache.evictRequest(req, res);
          }
        } else {
          // cache the response for transport
          cache.receiveResponse(req, res);
        }
      } catch (error: any) {
        cache.receiveError(req, error);
      };
    }
    // give the caller back the response from the cache. they don't get the real response.
    return reifyCachedResponse(responsePromise);
  } else {
    // IS_CLIENT
    const cache = getCache().client();
    const responsePromise = cache.receiveRequest(req);
    if (responsePromise) {
      // cache hit. wait for the response (data might be here already, or it might be a late arrival),
      // then consume it and replay it isomorphically
      return reifyCachedResponse(responsePromise)
        .finally(() => cache.consumeResponse(req));
    } else {
      // either we're post-hydration, or the client made a non-isomorphic request.
      // either way, all we can do is pass through
      return doNativeFetch();
    }
  }
}

const interceptRequest: FetchRequestInterceptor = (url, init) => {
  const interceptor = RLS().interceptor ?? defaultInterceptor;
  return interceptor(url, init);
}

const defaultInterceptor: FetchRequestInterceptor = (url, init) => {
  return { url, init };
}

function resolveRelativeUrl(url: string): string {
  // can't use relative urls server-side
  if (!globalThis.IS_SERVER) return url;
  if (!isRelativeUrl(url)) return url;
  return getResolvedUrl(url);
}

function resolveForwardedCookies(url: string, init: RequestInit = {}, forceForwardRequestCookies?: boolean): RequestInit {
  if (!globalThis.IS_SERVER) return init;
  if (!shouldForwardCookies(url, init, forceForwardRequestCookies)) return init;
  return {
    ...init,
    headers: getForwardedCookieHeaders(init),
  };
}

function getResolvedUrl(url: string): string {
  const origin = RLS().relativeUrlPrefix;
  if (!origin) {
    throw new Error('[verso] no origin for server-side fetch; cannot resolve relative url!');
  }
  return origin + url;
}

function shouldForwardCookies(url: string, init: RequestInit | null, forceForwardRequestCookies?: boolean): boolean {
  if (init?.credentials === 'omit') return false; // leaning towards security in this edge case
  return (
    init?.credentials === 'include' ||
    forceForwardRequestCookies ||
    isSameOrigin(url)
  );
}

function getForwardedCookieHeaders(init: RequestInit | null): Headers {
  const headers = new Headers(init?.headers);
  headers.set('Cookie', ServerCookies.get()!.getRequestCookieHeader());
  return headers;
}

function isSameOrigin(urlString: string): boolean {
  if (isRelativeUrl(urlString)) return true;
  const url = new URL(urlString);
  if (url.origin === RLS().requestOrigin) return true;
  return false;
}

function isRelativeUrl(url: string): boolean {
  return url.startsWith('/');
}

const TEXT_CONTENT_TYPE_RE = /^(text\/|application\/(\S+\+)?(json|xml))/;

function isBinaryResponse(res: Response): boolean {
  const contentType = res.headers.get('Content-Type');
  return !contentType?.match(TEXT_CONTENT_TYPE_RE);
}
