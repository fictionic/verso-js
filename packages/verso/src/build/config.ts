export interface VersoConfig {
  server?: Partial<ServerSettings>;
  middleware?: string[];
  routes: RoutesMap;
}

export type FetchOrigin = 'request-host' | 'loopback';

// note that these are currently serialized into the server entrypoint.
// non-serializable values cannot be added
export type ServerSettings = {
  /**
   * How to handle server-side fetch() requests made against relative URLs.
   * - 'request-host':
   *     Use the origin from the Host header of the Verso request.
   *     This guarantees isomorphism between server and client, but
   *     involves going out through the public internet, which can be slow.
   * - 'loopback':
   *     Use the loopback address to talk to the same Verso server.
   *     In fact, with this setting, fetch() won't make an HTTP request at all;
   *     it will simply execute the request against the Verso server within the
   *     same process.
   *     Of course, you should only set this if you know all requests
   *     to relative URLs are actually routed by your Verso server.
   *
   * If neither of these is desireable, configure an interceptor via
   * setFetchInterceptor(), and rewrite relative URLs to absolute URLs as desired.
   *
   * Default: 'request-host'.
   */
  fetchOrigin: FetchOrigin;
  /**
   * Failsafe timeout, in ms, for the server-side resolution of getRouteDirective.
   * Timeouts result in an HTTP 500.
   *
   * Default: 20_000 (20 seconds).
   */
  routerTimeout: number;
  /**
   * Failsafe timeout, in ms, for the full server-side response. If the timeout is hit
   * during render, the request will be aborted--all unrendered Roots will be skipped.
   * (Similarly for endpoints.)
   *
   * Default: 20_000 (20 seconds).
   */
  responseTimeout: number;
};

export function fillServerSettings(s?: Partial<ServerSettings>): ServerSettings {
  const fetchOrigin = s?.fetchOrigin ?? 'request-host' as const;
  const routerTimeout = s?.routerTimeout ?? 20_000;
  const renderTimeout = s?.responseTimeout ?? 20_000;
  return {
    fetchOrigin,
    routerTimeout,
    responseTimeout: renderTimeout,
  }
};

export type RoutesMap = {
  [routeName: string]: {
    path: string;
    handler: string;
    method?: string | string[];
  };
};

export function defineConfig(config: VersoConfig): VersoConfig {
  return config;
}
