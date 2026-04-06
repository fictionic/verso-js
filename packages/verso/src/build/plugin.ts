import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import type { Plugin, ViteDevServer } from 'vite';
import type { VersoConfig } from '../VersoConfig';
import type { SiteConfig, Routes } from '../core/router';
import type { RouteHandler } from '../core/handler/RouteHandler';
import type { Script, Stylesheet } from '../core/handler/Page';
import type { BundleManifest } from './bundle';
import { BUNDLES_DIR } from './bundle';
import { DEV_ROUTE_CSS_PATH } from '../core/constants';
import { createRouter } from '../core/router';
import { createViteBundleLoader } from '../core/middleware/ViteBundleLoader';
import { toWebRequest, sendWebResponse } from '../server/nodeHttp';
import { makeUnifiedEntrypoint, makeServerEntry } from './entrypoint';
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
  '@verso-js/store-adapter-valtio',
  // TODO: is there a better way?
];

export default function verso(options: VersoConfig): Plugin[] {
  const routesPath = path.resolve(process.cwd(), options.routes);
  const routesDir = path.dirname(routesPath);

  // Lazily populated after Vite server is up (dev) or at build time
  let site: SiteConfig | undefined;
  let routes: Routes | undefined;
  let isBuild = false;
  let isSSRBuild = false;
  let handlerPathToRoute: Record<string, string> = {};
  let resolvedRoot = '';
  let resolvedOutDir = '';

  return [
    // React plugin must be at the top level (not returned from a config hook)
    // so Vite registers its resolveId/load filters for /@react-refresh.
    // TODO: should we let consumers declare this on their own, in case they don't want it?
    // (this might make it harder to inject the react preamble)
    ...react(),

    {
      name: '@verso-js/verso:config',

      async config(_userConfig, env) {
        if (env.command === 'build') {
          isBuild = true; // needed for passing the manifest to the unified entrypoint
          isSSRBuild = !!_userConfig.build?.ssr;

          // Load routes via jiti so virtual modules and generateBundle
          // have them available. Handlers are NOT loaded here — they may
          // import CSS or other assets that jiti can't process. Handler
          // type inspection happens in buildStart via a temporary Vite
          // server that can process the full module graph.
          if (!routes) {
            site = await importModule<SiteConfig>(routesPath);
            routes = site.routes;

            handlerPathToRoute = {};
            for (const [routeName, routeConfig] of Object.entries(routes)) {
              const handlerPath = path.resolve(routesDir, routeConfig.handler);
              handlerPathToRoute[handlerPath] = routeName;
            }
          }
        }

        const shared: Record<string, any> = {
          resolve: {
            alias: {
              '@/': path.resolve(SOURCE_ROOT) + '/',
            },
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
              IS_DEV: 'true', // tell styleTransitioner to adopt vite styles
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
              IS_DEV: 'false',
              __BUILD_ID__: new Date().getTime(), // unique opaque id
            },
            build: {
              manifest: !isSSRBuild,
              emptyOutDir: !isSSRBuild,
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
                  entryFileNames: `${BUNDLES_DIR}/[name]-[hash].js`,
                  chunkFileNames: `${BUNDLES_DIR}/[name]-[hash].js`,
                  assetFileNames: `${BUNDLES_DIR}/[name]-[hash][extname]`,
                },
              },
            },
          };
        }
      },

      configResolved(config) {
        resolvedRoot = config.root;
        resolvedOutDir = path.resolve(config.root, config.build.outDir);
      },
    },

    {
      name: '@verso-js/verso:virtual-modules',

      resolveId(id) {
        switch (id) {
          case CLIENT_ENTRY_VIRTUAL_ID:
            return CLIENT_ENTRY_RESOLVED_ID;
          case SERVER_ENTRY_VIRTUAL_ID:
            return SERVER_ENTRY_RESOLVED_ID;
          default:
            return null;
        }
      },

      load(id) {
        if (id === CLIENT_ENTRY_RESOLVED_ID) {
          if (!routes) throw new Error('Routes not loaded yet');
          const allRouteNames = Object.keys(routes);
          return makeUnifiedEntrypoint(allRouteNames, routes, routesDir, routesPath, BOOTSTRAP_PATH, isBuild);
        }

        if (id === SERVER_ENTRY_RESOLVED_ID) {
          if (!routes) throw new Error('Routes not loaded yet');
          return makeServerEntry(routesPath, routes, SOURCE_ROOT);
        }
      },

      async writeBundle(_options, bundle) {
        // Only emit manifest + meta during client build
        if (isSSRBuild) return;

        // Parse Vite's built-in manifest (has transitive CSS + import chains)
        const viteManifestAsset = bundle['.vite/manifest.json'];
        if (!viteManifestAsset || viteManifestAsset.type !== 'asset') {
          throw new Error('[verso] Vite manifest not found — ensure build.manifest is enabled');
        }
        const viteManifest: Record<string, ViteManifestEntry> = JSON.parse(
          typeof viteManifestAsset.source === 'string'
            ? viteManifestAsset.source
            : new TextDecoder().decode(viteManifestAsset.source)
        );

        // Find the entry and resolve its transitive imports (deps first, entry last)
        let entryKey: string | undefined;
        for (const [key, entry] of Object.entries(viteManifest)) {
          if (entry.isEntry) { entryKey = key; break; }
        }
        if (!entryKey) throw new Error('[verso] Entry chunk not found in Vite manifest');
        const entryScripts = resolveImportFiles(entryKey, viteManifest);
        const entryScriptSet = new Set(entryScripts);
        const entryCss = viteManifest[entryKey]!.css ?? [];

        // Match dynamic entries to routes via handler paths
        const routeManifestKeys: Record<string, string> = {};
        for (const [key, entry] of Object.entries(viteManifest)) {
          if (!entry.isDynamicEntry) continue;
          const absoluteKey = path.resolve(resolvedRoot, key);
          const routeName = matchHandlerPath(absoluteKey, handlerPathToRoute);
          if (routeName) {
            routeManifestKeys[routeName] = key;
          }
        }

        // Build verso manifest from Vite's
        const manifest: BundleManifest = {};
        for (const routeName of Object.keys(routes!)) {
          const routeKey = routeManifestKeys[routeName];
          const routeEntry = routeKey ? viteManifest[routeKey] : undefined;

          // Preloads: route chunk + transitive deps, minus entry scripts
          const preloads = routeKey
            ? resolveImportFiles(routeKey, viteManifest).filter(f => !entryScriptSet.has(f))
            : [];

          // Stylesheets: entry CSS + route CSS, deduped (both already transitive)
          const routeCss = routeEntry?.css ?? [];
          const stylesheets = [...new Set([...entryCss, ...routeCss])];

          manifest[routeName] = { scripts: entryScripts, preloads, stylesheets };
        }

        // Write manifest + meta to disk
        const manifestJson = JSON.stringify(manifest, null, 2);
        const port = options.server?.port ?? 3000;
        const versoMeta = JSON.stringify({
          server: {
            port,
            urlPrefix: options.server?.urlPrefix ?? `http://localhost:${port}`,
            renderTimeout: options.server?.renderTimeout,
          },
        }, null, 2);

        await Promise.all([
          writeFile(path.join(resolvedOutDir, 'manifest.json'), manifestJson),
          writeFile(path.join(resolvedOutDir, `${BUNDLES_DIR}/manifest.js`), `export default ${manifestJson}`),
          writeFile(path.join(resolvedOutDir, 'verso-meta.json'), versoMeta),
        ]);
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
        let currentRouteStylesheets: Record<string, Stylesheet[]> = {};
        const setupPromise = (async () => {
          site = await ssrLoadDefault<SiteConfig>(vite, routesPath);
          routes = site.routes;
          router = createRouter(routes);

          const routeScripts: Record<string, string[]> = {};
          for (const routeName of Object.keys(routes)) {
            routeScripts[routeName] = [entryUrl];
          }
          const viteDevScripts: Script[] = [
            { content: react.preambleCode.replace('__BASE__', '/'), type: 'module' }, // vite react hmr preamble (inline)
            { src: '/@vite/client', type: 'module' }, // vite dev client
          ];
          const bundleLoader = createViteBundleLoader(() => ({
            routeScripts,
            routeStylesheets: currentRouteStylesheets,
            globalScripts: viteDevScripts,
          }));
          allMiddleware = [bundleLoader, ...(site.middleware ?? [])];
        })();

        // Add middleware directly (not via return) so it runs BEFORE Vite's
        // built-in static file serving. Unmatched routes fall through to Vite.
        vite.middlewares.use(async (req, res, next) => {
          await setupPromise;
          if (!routes) return next();

          try {
            const url = new URL(req.url ?? '/', urlPrefix);

            // Dev-only endpoint: return the CSS stylesheet list for a route, so the
            // client can transition stylesheets during programmatic navigation the
            // same way it does in prod (from the bundle manifest).
            if (url.pathname === DEV_ROUTE_CSS_PATH) {
              const routeName = url.searchParams.get('route');
              if (!routeName || !routes[routeName]) {
                res.statusCode = 404;
                res.end();
                return;
              }
              const handlerPath = resolveHandler(routesPath, routes[routeName].handler);
              // Ensure the handler module graph is populated before walking it
              await vite.ssrLoadModule(handlerPath);
              const { collectCss } = await vite.ssrLoadModule(
                path.resolve(SOURCE_ROOT, 'build/collectCss.ts'),
              ) as typeof import('./collectCss');
              const stylesheets = await collectCss(vite, handlerPath);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ stylesheets }));
              return;
            }

            const route = router.matchRoute(url.pathname, req.method ?? 'GET');

            if (!route) return next();

            const handlerPath = resolveHandler(routesPath, route.handler);
            const handler = await ssrLoadDefault<RouteHandler<any, any, any>>(
              vite,
              handlerPath,
            );

            // Collect CSS from Vite's module graph for this handler
            const { collectCss } = await vite.ssrLoadModule(
              path.resolve(SOURCE_ROOT, 'build/collectCss.ts'),
            ) as typeof import('./collectCss');
            currentRouteStylesheets = {
              [route.routeName]: await collectCss(vite, handlerPath),
            };

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

interface ViteManifestEntry {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}

/** Walk a manifest entry's import chain, returning output file paths in dependency order (leaves first). */
function resolveImportFiles(
  key: string,
  manifest: Record<string, ViteManifestEntry>,
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(key)) return [];
  visited.add(key);
  const entry = manifest[key];
  if (!entry) return [];
  const files: string[] = [];
  for (const imp of entry.imports ?? []) {
    files.push(...resolveImportFiles(imp, manifest, visited));
  }
  files.push(entry.file);
  return files;
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
