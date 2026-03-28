import type {MiddlewareDefinition} from "../core/handler/Middleware";
import {defineMiddleware} from "../core/handler/Middleware";
import type {Script, Stylesheet, LinkTag} from "../core/handler/Page";

interface ViteBundleLoaderConfig {
  preamble: string;
  routeScripts: Record<string, string[]>;
  routeStylesheets: Record<string, string[]>;
  routePreloads?: Record<string, string[]>;
}

export function createViteBundleLoader(config: ViteBundleLoaderConfig): MiddlewareDefinition<'page'> {
  return defineMiddleware('page', ({ getRoute }) => ({
    getSystemStylesheets: (next) => {
      const routeName = getRoute().getName();
      const stylesheets: Stylesheet[] = (config.routeStylesheets[routeName] ?? [])
        .map(href => ({ href }));
      return [...stylesheets, ...next()];
    },
    getSystemLinkTags: (next) => {
      const routeName = getRoute().getName();
      const preloads: LinkTag[] = (config.routePreloads?.[routeName] ?? [])
        .map(href => ({ rel: 'modulepreload', href }));
      return [...preloads, ...next()];
    },
    getSystemScripts: (next) => {
      const routeName = getRoute().getName();
      const routeScripts = (config.routeScripts[routeName] ?? [])
        .map(src => ({ src, type: 'module', async: true } satisfies Script));
      const devScripts: Script[] = config.preamble
        ? [{ content: config.preamble, type: 'module' }, { src: '/@vite/client', type: 'module' }]
        : [];
      return [...devScripts, ...routeScripts, ...next()];
    },
  }));
}
