import {buildClientBundle} from "../buildClientBundle";
import {handlePage} from "./handlePage";
import {createRouter, type SluiceRoutes} from "./router";

interface SluiceServerConfig {
  routes: SluiceRoutes;
  routesModulePath: string;
  urlPrefix: string;
  renderTimeout?: number;
}

interface SluiceServer {
  routes: Record<string, { GET: () => Response }>; // client bundle route
  serve: (req: Request) => Promise<Response>; // ssr handler
}

export async function createSluiceServer(config: SluiceServerConfig): Promise<SluiceServer> {
  const clientJs = await buildClientBundle(config.routesModulePath);
  const clientBundleRoutes = {
    '/client.js': {
      GET: () => new Response(clientJs, { headers: { 'Content-Type': 'application/javascript' } }),
    },
  };
  const router = createRouter(config.routes);
  return {
    routes: clientBundleRoutes,
    serve: (req: Request) => {
      const result = router.matchRoute(new URL(req.url).pathname);
      if (!result) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const { page, params } = result;
      return handlePage(req, page, params, {
        clientBundleUrl: '/client.js',
        urlPrefix: config.urlPrefix,
      });
    }
  };
}
