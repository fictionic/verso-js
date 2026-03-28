import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createRouter, type SiteConfig } from '../server/router';
import { versoVitePlugin, virtualModuleId } from './versoVitePlugin';
import { createViteBundleLoader } from '../middleware/ViteBundleLoader';
import { toWebRequest, sendWebResponse } from '../server/nodeHttp';
import type {RouteHandler} from '../core/handler/RouteHandler';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDLE_ROUTE_PATH = path.resolve(__dirname, '../server/handleRoute.ts');

interface DevServerConfig {
  siteConfigPath: string;
  urlPrefix?: string;
  port?: number;
}

export async function createDevServer(config: DevServerConfig) {
  const siteConfigPath = config.siteConfigPath;

  // Site config is loaded after Vite creation via ssrLoadModule (it may
  // import .tsx middleware). The plugin reads routes lazily through a getter
  // since virtual module load() hooks only fire after the server is up.
  let site: SiteConfig;

  const vite = await createViteServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), 'src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    ssr: {
      noExternal: ['@verso-js/verso', '@verso-js/stores', '@verso-js/store-adapters'],
    },
    define: {
      IS_SERVER: 'true',
    },
    environments: {
      client: {
        define: {
          IS_SERVER: 'false',
        },
      },
    },
    plugins: [
      react(),
      versoVitePlugin(() => site.routes, siteConfigPath),
    ],
  });

  site = await ssrLoadDefault<SiteConfig>(vite, siteConfigPath);
  const router = createRouter(site.routes);

  const routeScripts: Record<string, string[]> = {};
  for (const routeName of Object.keys(site.routes)) {
    routeScripts[routeName] = [`/@id/__x00__${virtualModuleId(routeName)}`];
  }
  const bundleLoader = createViteBundleLoader({
    preamble: react.preambleCode.replace('__BASE__', '/'),
    routeScripts,
    routeStylesheets: {},
  });
  const systemMiddleware = [bundleLoader];
  const allMiddleware = [...systemMiddleware, ...(site.middleware ?? [])];

  const port = config.port ?? 3000;
  const urlPrefix = config.urlPrefix ?? `http://localhost:${port}`;

  const server = http.createServer(async (nodeReq, nodeRes) => {
    try {
      const url = new URL(nodeReq.url ?? '/', urlPrefix);
      const route = router.matchRoute(url.pathname, nodeReq.method ?? 'GET');

      if (route) {
        const handler = await ssrLoadDefault<RouteHandler<any, any, any>>(vite, resolveHandler(siteConfigPath, route.handler));
        const { handleRoute } = await vite.ssrLoadModule(HANDLE_ROUTE_PATH) as typeof import('../server/handleRoute');
        const request = toWebRequest(nodeReq, url);
        const response = await handleRoute(
          handler.type,
          route,
          handler,
          allMiddleware,
          request,
          {
            urlPrefix,
          },
        );
        await sendWebResponse(nodeRes, response);
      } else {
        // Fall through to Vite for client modules, HMR websocket, static assets
        vite.middlewares(nodeReq, nodeRes);
      }
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      console.error('[verso]', e);
      nodeRes.statusCode = 500;
      nodeRes.end();
    }
  });

  server.listen(port, () => {
    console.log(`[verso] Dev server running at ${urlPrefix}`);
  });

  return { server, vite };
}

async function ssrLoadDefault<T>(vite: ViteDevServer, modulePath: string): Promise<T> {
  const mod = await vite.ssrLoadModule(modulePath);
  return (mod.default ?? mod) as T;
}

function resolveHandler(siteConfigPath: string, handlerPath: string): string {
  const routesDir = path.dirname(siteConfigPath);
  return path.resolve(routesDir, handlerPath);
}

