import type {BundleResult} from "../build/bundle";
import type {Stylesheet} from "../core/handler/Page";
import type {MiddlewareDefinition} from "../core/handler/Middleware";
import {createRouter} from "../core/router";
import {handleRoute} from "../server/handleRoute";
import {html404, html500} from "../server/errorPages";
import {createViteBundleLoader} from "./ViteBundleLoader";
import type {RoutesMap, ServerSettings} from './config';
import type {RouteHandlerDefinition} from "../core/handler/RouteHandler";

interface VersoServer {
  serve: (req: Request) => Promise<Response>;
}

export type RouteHandlers = {
  [routeName: string]: RouteHandlerDefinition<any, any, any>;
};

export async function createVersoServer(
  routes: RoutesMap,
  routeHandlers: RouteHandlers,
  middleware: MiddlewareDefinition[],
  bundleResult: BundleResult,
  serverSettings: ServerSettings,
): Promise<VersoServer> {
  const bundlesByPath = new Map<string, { contents: string; contentType: string }>();
  const { bundleContents } = bundleResult;
  for (const [bundlePath, contents] of Object.entries(bundleContents)) {
    const isCss = bundlePath.endsWith('.css'); // TODO allow for configuring different css extensions?
    bundlesByPath.set(`/${bundlePath}`, {
      contents,
      contentType: isCss ? 'text/css' : 'application/javascript',
    });
  }

  const router = createRouter(routes);

  const { manifest } = bundleResult;

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
        return Promise.resolve(new Response(html404, {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }));
      }
      const handler = routeHandlers[route.routeName];
      if (!handler) {
        console.error("no handler for route!");
        return Promise.resolve(new Response(html500, {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }));
      }
      const allMiddleware = [...systemMiddleware, ...middleware];
      return handleRoute(handler.type, route, handler, allMiddleware, req, serverSettings);
    }
  };
}
