import type {BundleResult} from "../build/bundle";
import type {Stylesheet} from "../core/handler/Page";
import {createRouter, type SiteConfig} from "../core/router";
import {handleRoute} from "../server/handleRoute";
import {createViteBundleLoader} from "../core/middleware/ViteBundleLoader";

interface VersoServerConfig {
  site: SiteConfig;
  bundleResult: BundleResult;
  urlPrefix?: string;
  renderTimeout?: number;
}

interface VersoServer {
  serve: (req: Request) => Promise<Response>;
}

export async function createVersoServer(config: VersoServerConfig): Promise<VersoServer> {
  const bundlesByPath = new Map<string, { contents: string; contentType: string }>();
  for (const [bundlePath, contents] of Object.entries(config.bundleResult.bundleContents)) {
    const isCss = bundlePath.endsWith('.css');
    bundlesByPath.set(`/${bundlePath}`, {
      contents,
      contentType: isCss ? 'text/css' : 'application/javascript',
    });
  }

  const site = config.site;
  const { routes } = site;
  const router = createRouter(routes);
  const { handlersByRoute, manifest } = config.bundleResult;

  // Build per-route script/stylesheet/preload maps from the manifest
  const routeScripts: Record<string, string[]> = {};
  const routeStylesheets: Record<string, Stylesheet[]> = {};
  const routePreloads: Record<string, string[]> = {};
  for (const [routeName, assets] of Object.entries(manifest)) {
    routeScripts[routeName] = assets.scripts.map(s => `/${s}`);
    routeStylesheets[routeName] = assets.stylesheets.map(s => ({ href: `/${s}` }));
    routePreloads[routeName] = (assets.preloads ?? []).map(s => `/${s}`);
  }

  // global preload for the manifest itself, for client transition css
  // (so the dynamic import() from bootstrap() will be instant)
  const manifestUrl = '/bundles/manifest.js';

  const bundleLoader = createViteBundleLoader(() => ({
    routeScripts,
    routeStylesheets,
    routePreloads,
    globalPreloads: [manifestUrl],
  }));
  const systemMiddleware = [bundleLoader];

  return {
    serve: (req: Request) => {
      const url = new URL(req.url);

      // Serve client bundles
      const bundle = bundlesByPath.get(url.pathname);
      if (bundle) {
        return Promise.resolve(new Response(bundle.contents, {
          headers: { 'Content-Type': bundle.contentType },
        }));
      }

      // SSR route matching
      const route = router.matchRoute(url.pathname, req.method);
      if (!route) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const handler = handlersByRoute[route.routeName]!;
      const allMiddleware = [...systemMiddleware, ...(site.middleware ?? [])];
      return handleRoute(handler.type, route, handler, allMiddleware, req, {
        urlPrefix: config.urlPrefix,
      });
    }
  };
}
