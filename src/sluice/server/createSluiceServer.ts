import path from 'node:path';
import type {BundleResult} from "../bundle";
import {handlePage} from "./handlePage";
import {createRouter, type SluiceRoutes} from "./router";

interface SluiceServerConfig {
  routesPath: string;
  bundleResult: BundleResult;
  urlPrefix: string;
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
  const routes: SluiceRoutes = (await import(config.routesPath)).default;
  const router = createRouter(routes);
  const routesDir = path.dirname(config.routesPath);
  const pageClassesByRoute = Object.assign({}, ...await Promise.all(Object.entries(routes).map(async ([routeName, { page }]) => {
    return {
      [routeName]: (await import(path.resolve(routesDir, page))).default,
    };
  })));
  return {
    routes: clientBundleRoutes,
    serve: (req: Request) => {
      const result = router.matchRoute(new URL(req.url).pathname);
      if (!result) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const { routeName, params: routeParams } = result;
      const PageClass = pageClassesByRoute[routeName];
      return handlePage(req, PageClass, routeParams, {
        routeAssets: config.bundleResult.manifest[routeName]!,
        urlPrefix: config.urlPrefix,
      });
    }
  };
}
