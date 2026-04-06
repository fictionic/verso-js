import type {MiddlewareDefinition} from "../handler/Middleware";
import {defineMiddleware} from "../handler/Middleware";
import type {Script, Stylesheet, LinkTag} from "../handler/Page";

export interface ViteBundleLoaderConfig {
  routeScripts: Record<string, string[]>;
  routeStylesheets: Record<string, Stylesheet[]>;
  routePreloads?: Record<string, string[]>;
  globalScripts?: Script[];
  globalPreloads?: string[];
}

export function createViteBundleLoader(getConfig: () => ViteBundleLoaderConfig): MiddlewareDefinition<'page'> {
  return defineMiddleware('page', ({ getRoute }) => ({
    getSystemStylesheets: (next) => {
      const config = getConfig();
      const routeName = getRoute().getName();
      const stylesheets: Stylesheet[] = config.routeStylesheets[routeName] ?? [];
      return [...stylesheets, ...next()];
    },
    getSystemLinkTags: (next) => {
      const config = getConfig();
      const routeName = getRoute().getName();
      const routePreloads: LinkTag[] = (config.routePreloads?.[routeName] ?? [])
        .map(href => ({ rel: 'modulepreload', href }));
      const globalPreloads: LinkTag[] = (config.globalPreloads ?? [])
        .map(href => ({ rel: 'modulepreload', href }));
      return [...globalPreloads, ...routePreloads, ...next()];
    },
    getSystemScripts: (next) => {
      const config = getConfig();
      const routeName = getRoute().getName();
      const routeScripts: Script[] = (config.routeScripts[routeName] ?? [])
        .map(src => ({ src, type: 'module', async: true /* TODO: async needed? from claude */ }));
      const globalScripts: Script[] = config.globalScripts ?? [];
      return [...globalScripts, ...routeScripts, ...next()];
    },
  }));
}
