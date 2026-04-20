export interface VersoConfig {
  server?: ServerSettings;
  middleware?: string[];
  routes: RoutesMap;
}

export type ServerSettings = {
  // note that these are currently serialized into the server entrypoint.
  // non-serializable values cannot be added
  port?: number;
  urlPrefix?: string;
  renderTimeout?: number;
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
