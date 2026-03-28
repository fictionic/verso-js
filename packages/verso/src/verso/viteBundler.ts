import path from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { build } from 'vite';
import type { BundleManifest, BundleResult } from './bundle';
import type { SiteConfig } from './server/router';
import type { RouteHandlerDefinition } from './core/handler/RouteHandler';
import { importModule } from './util/importModule';
import { makeEntrypoint } from './entrypoint';

const BUNDLES_DIR = 'bundles';

export async function bundle(siteConfigModulePath: string): Promise<BundleResult> {
  await mkdir(BUNDLES_DIR, { recursive: true });
  const site = await importModule<SiteConfig>(siteConfigModulePath);
  const rootDir = path.dirname(siteConfigModulePath);

  const handlersByRoute: Record<string, RouteHandlerDefinition<any, any, any>> = {};
  const input: Record<string, string> = {};
  await Promise.all(Object.entries(site.routes).map(async ([routeName, routeConfig]) => {
    const handler = await importModule<RouteHandlerDefinition<any, any, any>>(path.resolve(rootDir, routeConfig.handler));
    handlersByRoute[routeName] = handler;
    if (handler.type === 'page') {
      const entrypointPath = path.resolve(BUNDLES_DIR, `route-${routeName}.js`);
      await writeFile(entrypointPath, makeEntrypoint(routeConfig.handler, rootDir, siteConfigModulePath));
      input[routeName] = entrypointPath;
    }
  }));

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
          input,
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

    for (const item of output.output) {
      if (item.type === 'chunk' && item.isEntry) {
        manifest[item.name] = {
          scripts: [...item.imports, item.fileName],
          stylesheets: [...(item.viteMetadata?.importedCss ?? [])],
        };
      }
    }

    return { manifest, bundleContents, handlersByRoute: handlersByRoute };
  } finally {
    await rm(BUNDLES_DIR, { recursive: true }).catch(() => {});
  }
}

