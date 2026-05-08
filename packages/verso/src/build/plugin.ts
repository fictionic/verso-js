import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import type { BuildEnvironmentOptions, ConfigEnv, Plugin, ViteDevServer } from 'vite';
import { fillServerSettings, type VersoConfig } from './config';
import type { RouteHandler } from '../core/common/handler/RouteHandler';
import type { Script } from '../core/common/handler/Page';
import type { BundleManifest } from './bundle';
import { BUNDLES_DIR } from './bundle';
import { DEV_ROUTE_CSS_PATH } from '../core/common/constants';
import { createViteBundleLoader } from './ViteBundleLoader';
import { toURL, toWebRequest, sendWebResponse } from './nodeHttp';
import { getEntrypointGenerator, type EntrypointGenerator } from './entrypoint';
import { createJiti, type Jiti } from 'jiti';
import { html500 } from '../core/server/errorPages';
import {collectCss} from './collectCss';
import type {HandleRequest} from '../core/server/handleRequest';
import type { MiddlewareDefinition } from '../core/common/handler/Middleware';
import {createNavigator} from '../core/common/navigator';

const VERSO_CONFIG_FILE_NAME = 'verso.config.ts';

const VERSO_DIST_ROOT = path.dirname(fileURLToPath(import.meta.url)); // we are running from dist/plugin.js

// some modules we have to import dynamically through the vite module graph
const SERVER_PATH = path.resolve(VERSO_DIST_ROOT, 'server.js');

const CLIENT_ENTRY_VIRTUAL_ID = 'virtual:verso/entry';
const CLIENT_ENTRY_RESOLVED_ID = '\0' + CLIENT_ENTRY_VIRTUAL_ID;

const SERVER_ENTRY_VIRTUAL_ID = 'virtual:verso/server-entry';
const SERVER_ENTRY_RESOLVED_ID = '\0' + SERVER_ENTRY_VIRTUAL_ID;

const VERSO_PACKAGES = [
  // packages that use IS_SERVER or RequestLocalStorage
  '@verso-js/verso',
  '@verso-js/stores',
];

export default async function verso(configPathOverride?: string): Promise<Plugin[]> {

  // first load verso.config.ts
  const versoConfigPath = configPathOverride ?? path.resolve(process.cwd(), VERSO_CONFIG_FILE_NAME);
  const versoConfig = await importWithJiti<VersoConfig>(versoConfigPath);

  // then set up the context objects to be shared between plugins
  type VersoPluginConfigContext = {
    viteConfigEnv: ConfigEnv;
    viteBuildOpts: BuildEnvironmentOptions | null;
  };
  let configContext: VersoPluginConfigContext | null = null;

  function isBuild() {
    return configContext!.viteConfigEnv.command === 'build';
  }

  function isSSRBuild() {
    return !!configContext!.viteBuildOpts?.ssr;
  }

  type VersoPluginContext = {
    entrypointGenerator: EntrypointGenerator;
    handlerPathToRoute: Record<string, string>;
    resolvedRootDir: string;
    resolvedOutDir: string;
  };
  let pluginContext: VersoPluginContext | null = null;

  return [
    // React plugin must be at the top level (not returned from a config hook)
    // so Vite registers its resolveId/load filters for /@react-refresh.
    // TODO: should we let consumers declare this on their own, in case they don't want it?
    // (this might make it harder to inject the react preamble)
    ...react(),

    {
      name: '@verso-js/verso:config',

      async config(viteUserConfig, env) {

        configContext = {
          viteConfigEnv: env,
          viteBuildOpts: viteUserConfig.build ?? null
        };

        const shared: Record<string, any> = {
          resolve: {
            dedupe: ['react', 'react-dom'],
          },
          ssr: {
            noExternal: [...VERSO_PACKAGES],
          },
        };

        // Define strategy:
        // - `IS_SERVER` (bare) is the public contract for user code (declared
        //   in globals.d.ts). Replace it for DCE on server-only branches.
        // - `globalThis.IS_SERVER` / `globalThis.IS_DEV` is what verso's own
        //   source uses internally. This is defensive: a bare `IS_SERVER` at
        //   module scope would ReferenceError if the file were ever imported
        //   before Vite's defines are active (e.g. transitively from this
        //   plugin). Today nothing in the plugin's import chain hits those
        //   paths, but `globalThis.` keeps it safe if that changes.
        //   Replace both forms so Vite can DCE our runtime.
        if (env.command === 'serve') {
          return {
            ...shared,
            appType: 'custom',
            define: {
              IS_SERVER: 'true',
              'globalThis.IS_SERVER': 'true',
              'globalThis.IS_DEV': 'true', // tell styleTransitioner to adopt vite styles
            },
            environments: {
              client: {
                define: {
                  IS_SERVER: 'false',
                  'globalThis.IS_SERVER': 'false',
                },
              },
            },
          };
        }

        if (env.command === 'build') {
          const isServerReplacement = isSSRBuild() ? 'true' : 'false';
          return {
            ...shared,
            define: {
              IS_SERVER: isServerReplacement,
              'globalThis.IS_SERVER': isServerReplacement,
              'globalThis.IS_DEV': 'false',
              __BUILD_ID__: new Date().getTime(), // unique opaque id
            },
            build: {
              manifest: !isSSRBuild(),
              emptyOutDir: !isSSRBuild(),
              rolldownOptions: isSSRBuild() ? {
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

      async configResolved(config) {
        const resolvedRootDir = config.root; // the user might have set a custom root dir
        const resolvedOutDir = path.resolve(config.root, config.build.outDir);

        const handlerPathToRoute: Record<string, string> = {};
        for (const [routeName, routeConfig] of Object.entries(versoConfig.routes)) {
          const handlerPath = path.resolve(resolvedRootDir, routeConfig.handler);
          handlerPathToRoute[handlerPath] = routeName;
        }

        pluginContext = {
          resolvedOutDir,
          resolvedRootDir,
          handlerPathToRoute,
          entrypointGenerator: getEntrypointGenerator(resolvedRootDir, versoConfig, isBuild()),
        };
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

      async load(id) {
        const { entrypointGenerator } = pluginContext!;
        if (id === CLIENT_ENTRY_RESOLVED_ID) {
          return entrypointGenerator.generateClientEntrypoint();
        }

        if (id === SERVER_ENTRY_RESOLVED_ID) {
          return entrypointGenerator.generateServerEntrypoint();
        }
      },

      async writeBundle(_options, bundle) {
        // Only emit manifest + meta during client build
        if (isSSRBuild()) return;

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
          const absoluteKey = path.resolve(pluginContext!.resolvedRootDir, key);
          const routeName = matchHandlerPath(absoluteKey, pluginContext!.handlerPathToRoute);
          if (routeName) {
            routeManifestKeys[routeName] = key;
          }
        }

        // Build verso manifest from Vite's
        const manifest: BundleManifest = {};
        for (const routeName of Object.keys(versoConfig.routes)) {
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

        // Write manifest to disk
        const manifestJson = JSON.stringify(manifest, null, 2);
        const manifestPath = path.join(pluginContext!.resolvedOutDir, BUNDLES_DIR, 'manifest.js');
        await writeFile(manifestPath, `export default ${manifestJson}`);
      },
    },

    {
      name: '@verso-js/verso:dev-server',

      async configureServer(vite: ViteDevServer) {
        const serverSettings = fillServerSettings(versoConfig.server);
        const { port } = serverSettings;

        const { routes } = versoConfig;

        const entryUrl = `/@id/__x00__${CLIENT_ENTRY_VIRTUAL_ID}`;

        const handleRequest = await importWithVite<HandleRequest>(vite, SERVER_PATH);

        const routeScripts: Record<string, string[]> = {};
        for (const routeName of Object.keys(routes)) {
          routeScripts[routeName] = [entryUrl];
        }
        const viteDevScripts: Script[] = [
          { text: react.preambleCode.replace('__BASE__', '/'), type: 'module' }, // vite react hmr preamble (inline)
          // TODO why do we need to replace __BASE__ with '/'? what is '/'?
          { src: '/@vite/client', type: 'module' }, // vite dev client
        ];
        const bundleLoader = createViteBundleLoader({
          getRouteStylesheets: async (routeName) => {
            const handlerPath = path.resolve(pluginContext!.resolvedRootDir, routes[routeName]!.handler);
            return await collectCss(vite, handlerPath);
          },
          getRouteModulePreloadUrls: () => [],
          getRouteScriptUrls: (routeName) => routeScripts[routeName] ?? [],
          globalScripts: viteDevScripts,
        });
        const systemMiddleware = [bundleLoader];

        const siteMiddlewarePaths = versoConfig.middleware ?? [];
        const siteMiddleware = await Promise.all(
          siteMiddlewarePaths.map((modulePath) => importWithVite<MiddlewareDefinition>(vite, modulePath))
        );
        const globalMiddleware: Array<MiddlewareDefinition> = [...systemMiddleware, ...siteMiddleware];

        const getRouteHandler = async (handlerPath: string) => {
          const absoluteHandlerPath = path.resolve(pluginContext!.resolvedRootDir, handlerPath);
          return await importWithVite<RouteHandler<any, any, any>>(
            vite,
            absoluteHandlerPath,
          );
        };
        const navigator = createNavigator(routes, getRouteHandler, globalMiddleware);

        return () => {
          vite.middlewares.use(async (req, res) => {
            try {
              const url = toURL(req, port);

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
                const handlerPath = path.resolve(pluginContext!.resolvedRootDir, routes[routeName].handler);
                const stylesheets = await collectCss(vite, handlerPath);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ stylesheets }));
                return;
              }

              const request = toWebRequest(req, url);
              const response = await handleRequest(
                request,
                navigator,
                serverSettings,
              );
              await sendWebResponse(res, response);
            } catch (e) {
              vite.ssrFixStacktrace(e as Error);
              console.error('[verso]', e);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.end(html500);
            }
          });
        };
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

// TODO: what is this abstraction?
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

// for importing modules without a vite dev server.
// only needed for loading the verso config file
let jiti: Jiti;
async function importWithJiti<T>(modulePath: string): Promise<T> {
  if (!jiti) jiti = createJiti(import.meta.url);
  return await importWith(jiti.import.bind(jiti), modulePath);
}

async function importWithVite<T>(vite: ViteDevServer, modulePath: string): Promise<T> {
  return await importWith(vite.ssrLoadModule.bind(vite), modulePath);
}

async function importWith<T>(importer: (modulePath: string) => Promise<any>, modulePath: string): Promise<T> {
  const module = await importer(modulePath);
  const defaultExport = module.default as T;
  if (!defaultExport) {
    throw new Error(`no default export found when importing ${modulePath}`);
  }
  return defaultExport;
}
