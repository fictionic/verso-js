import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin, ViteDevServer } from 'vite';
import type { VersoConfig } from '../VersoConfig';
import type { SiteConfig, Routes } from '../core/router';
import type { RouteHandler, RouteHandlerDefinition } from '../core/handler/RouteHandler';
import type { BundleManifest } from './bundle';
import { createRouter } from '../core/router';
import { createViteBundleLoader } from '../core/middleware/ViteBundleLoader';
import { toWebRequest, sendWebResponse } from '../server/nodeHttp';
import { makeUnifiedEntrypoint } from './entrypoint';
import { importModule } from './importModule';

// When compiled by tsup, import.meta.url points to dist/plugin.js.
// When running in dev from source, it points to src/build/plugin.ts.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = __dirname.endsWith('build')
  ? path.resolve(__dirname, '..')       // src/build/ -> src/
  : path.resolve(__dirname, '../src'); // dist/ -> src/

const HANDLE_ROUTE_PATH = path.resolve(SOURCE_ROOT, 'server/handleRoute.ts');
const BOOTSTRAP_PATH = path.resolve(SOURCE_ROOT, 'client/bootstrap.ts');

const CLIENT_ENTRY_VIRTUAL_ID = 'virtual:verso/entry';
const CLIENT_ENTRY_RESOLVED_ID = '\0' + CLIENT_ENTRY_VIRTUAL_ID;

const SERVER_ENTRY_VIRTUAL_ID = 'virtual:verso/server-entry';
const SERVER_ENTRY_RESOLVED_ID = '\0' + SERVER_ENTRY_VIRTUAL_ID;

const VERSO_PACKAGES = [
  '@verso-js/verso',
  '@verso-js/stores',
  '@verso-js/store-adapter-zustand',
  '@verso-js/store-adapter-redux',
];

export default function verso(options: VersoConfig): Plugin[] {
  const routesPath = path.resolve(process.cwd(), options.routes);
  const routesDir = path.dirname(routesPath);

  // Lazily populated after Vite server is up (dev) or at build time
  let site: SiteConfig | undefined;
  let routes: Routes | undefined;
  let isSSRBuild = false;
  let pageRouteNames: string[] = [];
  let handlerPathToRoute: Record<string, string> = {};

  return [
    // React plugin must be at the top level (not returned from a config hook)
    // so Vite registers its resolveId/load filters for /@react-refresh.
    ...react(),

    {
      name: '@verso-js/verso:config',

      async config(_userConfig, env) {
        if (env.command === 'build') {
          isSSRBuild = !!_userConfig.build?.ssr;

          // Load routes + handlers eagerly via jiti so virtual modules
          // and generateBundle have them available.
          if (!routes) {
            site = await importModule<SiteConfig>(routesPath);
            routes = site.routes;

            pageRouteNames = [];
            handlerPathToRoute = {};
            await Promise.all(Object.entries(routes).map(async ([routeName, routeConfig]) => {
              const handlerPath = path.resolve(routesDir, routeConfig.handler);
              const handler = await importModule<RouteHandlerDefinition<any, any, any>>(handlerPath);
              if (handler.type === 'page') {
                pageRouteNames.push(routeName);
                handlerPathToRoute[handlerPath] = routeName;
              }
            }));
          }
        }

        const shared: Record<string, any> = {
          resolve: {
            dedupe: ['react', 'react-dom'],
          },
          ssr: {
            noExternal: [...VERSO_PACKAGES],
          },
        };

        if (env.command === 'serve') {
          return {
            ...shared,
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
          };
        }

        if (env.command === 'build') {
          return {
            ...shared,
            define: {
              IS_SERVER: isSSRBuild ? 'true' : 'false',
            },
            build: {
              rolldownOptions: isSSRBuild ? {
                input: { entry: SERVER_ENTRY_VIRTUAL_ID },
                output: {
                  format: 'es' as const,
                  entryFileNames: 'server/[name].js',
                  chunkFileNames: 'server/chunks/[name]-[hash].js',
                },
              } : {
                input: CLIENT_ENTRY_VIRTUAL_ID,
                output: {
                  format: 'es' as const,
                  entryFileNames: 'bundles/[name]-[hash].js',
                  chunkFileNames: 'bundles/[name]-[hash].js',
                  assetFileNames: 'bundles/[name]-[hash][extname]',
                },
              },
            },
          };
        }
      },
    },

    {
      name: '@verso-js/verso:virtual-modules',

      resolveId(id) {
        if (id === CLIENT_ENTRY_VIRTUAL_ID) return CLIENT_ENTRY_RESOLVED_ID;
        if (id === SERVER_ENTRY_VIRTUAL_ID) return SERVER_ENTRY_RESOLVED_ID;
      },

      load(id) {
        if (id === CLIENT_ENTRY_RESOLVED_ID) {
          if (!routes) throw new Error('Routes not loaded yet');
          const allRouteNames = Object.keys(routes);
          return makeUnifiedEntrypoint(allRouteNames, routes, routesDir, routesPath, BOOTSTRAP_PATH);
        }

        if (id === SERVER_ENTRY_RESOLVED_ID) {
          if (!routes) throw new Error('Routes not loaded yet');
          return makeServerEntry(routesPath, routes);
        }
      },

      generateBundle(_options, bundle) {
        // Only emit manifest + meta during client build
        if (isSSRBuild) return;

        // Find the entry chunk (shared by all routes)
        let entryFileName = '';
        let entryImports: string[] = [];
        for (const item of Object.values(bundle)) {
          if (item.type === 'chunk' && item.isEntry) {
            entryFileName = item.fileName;
            entryImports = [...(item.imports ?? [])];
            break;
          }
        }

        // Map dynamic import chunks back to routes via facadeModuleId
        const routeChunks: Record<string, { fileName: string; css: string[] }> = {};
        for (const item of Object.values(bundle)) {
          if (item.type !== 'chunk' || !item.isDynamicEntry || !item.facadeModuleId) continue;
          const routeName = matchHandlerPath(item.facadeModuleId, handlerPathToRoute);
          if (routeName) {
            routeChunks[routeName] = {
              fileName: item.fileName,
              css: [...((item as any).viteMetadata?.importedCss ?? [])],
            };
          }
        }

        // Build manifest: each page route gets the shared entry as its script,
        // plus its dynamic chunk as a preload
        const manifest: BundleManifest = {};
        const entryScripts = [...entryImports, entryFileName];
        for (const routeName of pageRouteNames) {
          const chunk = routeChunks[routeName];
          manifest[routeName] = {
            scripts: entryScripts,
            preloads: chunk ? [chunk.fileName] : [],
            stylesheets: chunk?.css ?? [],
          };
        }

        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: JSON.stringify(manifest, null, 2),
        });

        // Emit verso-meta.json so `verso start` doesn't need vite.config.ts
        const port = options.server?.port ?? 3000;
        this.emitFile({
          type: 'asset',
          fileName: 'verso-meta.json',
          source: JSON.stringify({
            server: {
              port,
              urlPrefix: options.server?.urlPrefix ?? `http://localhost:${port}`,
              renderTimeout: options.server?.renderTimeout,
            },
          }, null, 2),
        });
      },
    },

    {
      name: '@verso-js/verso:dev-server',

      configureServer(vite: ViteDevServer) {
        const port = options.server?.port ?? 3000;
        const urlPrefix = options.server?.urlPrefix ?? `http://localhost:${port}`;
        const entryUrl = `/@id/__x00__${CLIENT_ENTRY_VIRTUAL_ID}`;

        let router: ReturnType<typeof createRouter>;
        let allMiddleware: any[];
        const setupPromise = (async () => {
          site = await ssrLoadDefault<SiteConfig>(vite, routesPath);
          routes = site.routes;
          router = createRouter(routes);

          const routeScripts: Record<string, string[]> = {};
          for (const routeName of Object.keys(routes)) {
            routeScripts[routeName] = [entryUrl];
          }
          const bundleLoader = createViteBundleLoader({
            preamble: react.preambleCode.replace('__BASE__', '/'),
            routeScripts,
            routeStylesheets: {},
          });
          allMiddleware = [bundleLoader, ...(site.middleware ?? [])];
        })();

        // Add middleware directly (not via return) so it runs BEFORE Vite's
        // built-in static file serving. Unmatched routes fall through to Vite.
        vite.middlewares.use(async (req, res, next) => {
          await setupPromise;
          if (!routes) return next();

          try {
            const url = new URL(req.url ?? '/', urlPrefix);
            const route = router.matchRoute(url.pathname, req.method ?? 'GET');

            if (!route) return next();

            const handler = await ssrLoadDefault<RouteHandler<any, any, any>>(
              vite,
              resolveHandler(routesPath, route.handler),
            );
            const { handleRoute } = await vite.ssrLoadModule(HANDLE_ROUTE_PATH) as typeof import('../server/handleRoute');
            const request = toWebRequest(req, url);
            const response = await handleRoute(
              handler.type,
              route,
              handler,
              allMiddleware,
              request,
              { urlPrefix },
            );
            await sendWebResponse(res, response);
          } catch (e) {
            vite.ssrFixStacktrace(e as Error);
            console.error('[verso]', e);
            res.statusCode = 500;
            res.end();
          }
        });
      },
    },
  ];
}

function makeServerEntry(siteConfigModulePath: string, routes: Routes): string {
  const rootDir = path.dirname(siteConfigModulePath);
  const createVersoServerPath = path.resolve(SOURCE_ROOT, 'build/createVersoServer.ts');
  const handlerImports: string[] = [];
  const handlerEntries: string[] = [];

  for (const [routeName, routeConfig] of Object.entries(routes)) {
    const handlerPath = path.resolve(rootDir, routeConfig.handler);
    const safeName = routeName.replace(/[^a-zA-Z0-9_]/g, '_');
    handlerImports.push(`import handler_${safeName} from ${JSON.stringify(handlerPath)};`);
    handlerEntries.push(`  ${JSON.stringify(routeName)}: handler_${safeName},`);
  }

  return `
import { createVersoServer } from ${JSON.stringify(createVersoServerPath)};
import site from ${JSON.stringify(siteConfigModulePath)};
${handlerImports.join('\n')}

const handlersByRoute = {
${handlerEntries.join('\n')}
};

export async function createServer(config) {
  return createVersoServer({
    site,
    bundleResult: {
      manifest: config.manifest,
      bundleContents: config.bundleContents,
      handlersByRoute,
    },
    urlPrefix: config.urlPrefix,
    renderTimeout: config.renderTimeout,
  });
}
`.trimStart();
}

function matchHandlerPath(
  facadeId: string,
  handlerPathToRoute: Record<string, string>,
): string | undefined {
  if (handlerPathToRoute[facadeId]) return handlerPathToRoute[facadeId];
  for (const [handlerPath, routeName] of Object.entries(handlerPathToRoute)) {
    if (facadeId.startsWith(handlerPath + '.') || facadeId === handlerPath) {
      return routeName;
    }
  }
  return undefined;
}

async function ssrLoadDefault<T>(vite: ViteDevServer, modulePath: string): Promise<T> {
  const mod = await vite.ssrLoadModule(modulePath);
  return (mod.default ?? mod) as T;
}

function resolveHandler(siteConfigPath: string, handlerPath: string): string {
  const routesDir = path.dirname(siteConfigPath);
  return path.resolve(routesDir, handlerPath);
}
