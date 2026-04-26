export interface VersoConfig {
  server?: Partial<ServerSettings>;
  middleware?: string[];
  routes: RoutesMap;
}

export type FetchOrigin = 'request' | 'loopback';

export type ServerSettings = {
  // note that these are currently serialized into the server entrypoint.
  // non-serializable values cannot be added
  port: number;
  fetchOrigin: FetchOrigin;
  routerTimeout: number;
  renderTimeout: number;
};

export function fillServerSettings(s?: Partial<ServerSettings>): ServerSettings {
  const port = s?.port ?? 3000;
  const fetchOrigin = s?.fetchOrigin ?? 'request';
  const routerTimeout = s?.routerTimeout ?? 20_000;
  const renderTimeout = s?.renderTimeout ?? 20_000;
  return {
    port,
    fetchOrigin,
    routerTimeout,
    renderTimeout,
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
