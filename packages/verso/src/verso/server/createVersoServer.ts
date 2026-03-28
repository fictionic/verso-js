import type {BundleResult} from "../bundle";
import {createRouter, type SiteConfig} from "./router";
import {handleRoute} from "./handleRoute";
import {importModule} from "../util/importModule";

interface VersoServerConfig {
  siteConfigPath: string;
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

  const site = await importModule<SiteConfig>(config.siteConfigPath);
  const { routes } = site;
  const router = createRouter(routes);
  const { handlersByRoute } = config.bundleResult;

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
      return handleRoute(handler.type, route, handler, site.middleware ?? [], req, {
        urlPrefix: config.urlPrefix,
      });
    }
  };
}
