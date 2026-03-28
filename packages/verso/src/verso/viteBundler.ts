import path from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { build } from 'vite';
import type { BundleManifest, BundleResult } from './bundle';
import type { SiteConfig } from './server/router';
import type { RouteHandlerDefinition } from './core/handler/RouteHandler';
import { importModule } from './util/importModule';
import { makeUnifiedEntrypoint } from './entrypoint';

const BUNDLES_DIR = 'bundles';

export async function bundle(siteConfigModulePath: string): Promise<BundleResult> {
  await mkdir(BUNDLES_DIR, { recursive: true });
  const site = await importModule<SiteConfig>(siteConfigModulePath);
  const rootDir = path.dirname(siteConfigModulePath);

  const handlersByRoute: Record<string, RouteHandlerDefinition<any, any, any>> = {};
  const pageRouteNames: string[] = [];

  // Build a map from absolute handler path → route name, for matching chunks later
  const handlerPathToRoute: Record<string, string> = {};

  await Promise.all(Object.entries(site.routes).map(async ([routeName, routeConfig]) => {
    const handler = await importModule<RouteHandlerDefinition<any, any, any>>(path.resolve(rootDir, routeConfig.handler));
    handlersByRoute[routeName] = handler;
    if (handler.type === 'page') {
      pageRouteNames.push(routeName);
      const absoluteHandlerPath = path.resolve(rootDir, routeConfig.handler);
      // Vite may resolve with or without extension — store both for matching
      handlerPathToRoute[absoluteHandlerPath] = routeName;
    }
  }));

  // Generate a single unified entry
  const entrypointCode = makeUnifiedEntrypoint(pageRouteNames, site.routes, rootDir, siteConfigModulePath);
  const entrypointPath = path.resolve(BUNDLES_DIR, 'entry.js');
  await writeFile(entrypointPath, entrypointCode);

  try {
    const result = await build({
      configFile: false,
      root: process.cwd(),
      logLevel: 'warn',
      resolve: {
        alias: {
          '@': path.resolve(process.cwd(), 'src'),
        },
      },
      define: {
        IS_SERVER: 'false',
      },
      build: {
        write: false,
        minify: false,
        rolldownOptions: {
          input: { entry: entrypointPath },
          output: {
            format: 'es',
            entryFileNames: 'bundles/[name]-[hash].js',
            chunkFileNames: 'bundles/[name]-[hash].js',
            assetFileNames: 'bundles/[name]-[hash][extname]',
          },
        },
      },
    });

    const output = Array.isArray(result) ? result[0]! : result;
    if (!('output' in output)) {
      throw new Error('Vite build returned unexpected result');
    }

    const manifest: BundleManifest = {};
    const bundleContents: Record<string, string> = {};

    // Collect all chunk/asset contents
    for (const item of output.output) {
      if (item.type === 'chunk') {
        bundleContents[item.fileName] = item.code;
      } else if (item.type === 'asset') {
        bundleContents[item.fileName] =
          typeof item.source === 'string'
            ? item.source
            : new TextDecoder().decode(item.source);
      }
    }

    // Find the entry chunk (shared by all routes)
    let entryFileName = '';
    let entryImports: string[] = [];
    for (const item of output.output) {
      if (item.type === 'chunk' && item.isEntry) {
        entryFileName = item.fileName;
        entryImports = [...(item.imports ?? [])];
        break;
      }
    }

    // Map dynamic import chunks back to routes via facadeModuleId
    const routeChunks: Record<string, { fileName: string; css: string[] }> = {};
    for (const item of output.output) {
      if (item.type !== 'chunk' || !item.isDynamicEntry || !item.facadeModuleId) continue;
      const facadeId = item.facadeModuleId;
      // Try matching against handler paths (with and without common extensions)
      const routeName = matchHandlerPath(facadeId, handlerPathToRoute);
      if (routeName) {
        routeChunks[routeName] = {
          fileName: item.fileName,
          css: [...(item.viteMetadata?.importedCss ?? [])],
        };
      }
    }

    // Build the manifest: each page route gets the shared entry as its script,
    // plus its dynamic chunk as a preload
    const entryScripts = [...entryImports, entryFileName];
    for (const routeName of pageRouteNames) {
      const chunk = routeChunks[routeName];
      manifest[routeName] = {
        scripts: entryScripts,
        preloads: chunk ? [chunk.fileName] : [],
        stylesheets: chunk?.css ?? [],
      };
    }

    return { manifest, bundleContents, handlersByRoute };
  } finally {
    await rm(BUNDLES_DIR, { recursive: true }).catch(() => {});
  }
}

function matchHandlerPath(
  facadeId: string,
  handlerPathToRoute: Record<string, string>,
): string | undefined {
  // Direct match
  if (handlerPathToRoute[facadeId]) return handlerPathToRoute[facadeId];
  // Vite may resolve with an extension that wasn't in our map
  for (const [handlerPath, routeName] of Object.entries(handlerPathToRoute)) {
    if (facadeId.startsWith(handlerPath + '.') || facadeId === handlerPath) {
      return routeName;
    }
  }
  return undefined;
}

const SERVER_ENTRY_DIR = '.verso-server-entry';

function makeServerEntry(siteConfigModulePath: string, site: SiteConfig): string {
  const rootDir = path.dirname(siteConfigModulePath);
  const handlerImports: string[] = [];
  const handlerEntries: string[] = [];

  for (const [routeName, routeConfig] of Object.entries(site.routes)) {
    const handlerPath = path.resolve(rootDir, routeConfig.handler);
    const safeName = routeName.replace(/[^a-zA-Z0-9_]/g, '_');
    handlerImports.push(`import handler_${safeName} from ${JSON.stringify(handlerPath)};`);
    handlerEntries.push(`  ${JSON.stringify(routeName)}: handler_${safeName},`);
  }

  return `
import { createVersoServer } from '@verso-js/verso/server';
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

export async function bundleServer(
  siteConfigModulePath: string,
  site: SiteConfig,
): Promise<Record<string, string>> {
  await mkdir(SERVER_ENTRY_DIR, { recursive: true });
  const entryPath = path.resolve(SERVER_ENTRY_DIR, 'entry.ts');
  await writeFile(entryPath, makeServerEntry(siteConfigModulePath, site));

  try {
    const result = await build({
      configFile: false,
      root: process.cwd(),
      logLevel: 'warn',
      resolve: {
        alias: {
          '@': path.resolve(process.cwd(), 'src'),
        },
      },
      define: {
        IS_SERVER: 'true',
      },
      build: {
        write: false,
        minify: false,
        ssr: true,
        rolldownOptions: {
          input: { entry: entryPath },
          output: {
            format: 'es',
            entryFileNames: 'server/[name].js',
            chunkFileNames: 'server/chunks/[name]-[hash].js',
          },
        },
      },
    });

    const output = Array.isArray(result) ? result[0]! : result;
    if (!('output' in output)) {
      throw new Error('Vite server build returned unexpected result');
    }

    const serverBundleContents: Record<string, string> = {};
    for (const item of output.output) {
      if (item.type === 'chunk') {
        serverBundleContents[item.fileName] = item.code;
      }
    }

    return serverBundleContents;
  } finally {
    await rm(SERVER_ENTRY_DIR, { recursive: true }).catch(() => {});
  }
}
