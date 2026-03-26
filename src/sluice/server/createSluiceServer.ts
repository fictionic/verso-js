import type {BundleResult} from "../bundle";
import {createRouter, type SiteConfig} from "./router";
import {handleRoute} from "./handleRoute";

interface SluiceServerConfig {
  siteConfigPath: string;
  bundleResult: BundleResult;
  urlPrefix?: string;
  renderTimeout?: number;
}

interface SluiceServer {
  routes: Record<string, { GET: () => Response }>; // client bundles
  serve: (req: Request) => Promise<Response>; // ssr handler
}

export async function createSluiceServer(config: SluiceServerConfig): Promise<SluiceServer> {
  const clientBundleRoutes = Object.assign({}, ...Object.entries(config.bundleResult.bundleContents).map(([bundlePath, contents]) => {
    const isCss = bundlePath.endsWith('.css');
    return {
      [`/${bundlePath}`]: {
        GET: () => new Response(contents, { headers: { 'Content-Type': isCss ? 'text/css' : 'application/javascript' } }),
      },
    };
  }));
  const site: SiteConfig = (await import(config.siteConfigPath)).default;
  const { routes } = site;
  const router = createRouter(routes);
  const { handlersByRoute } = config.bundleResult;
  return {
    routes: clientBundleRoutes,
    serve: (req: Request) => {
      const result = router.matchRoute(new URL(req.url).pathname, req.method);
      if (!result) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const handler = handlersByRoute[result.routeName]!;
      const { routeName, params: routeParams } = result;
      return handleRoute(handler.type, req, handler, routeParams, site.middleware ?? [], {
        routeAssets: config.bundleResult.manifest[routeName]!,
        urlPrefix: config.urlPrefix,
      });
    }
  };
}
