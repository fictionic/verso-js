import path from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { BundleManifest, BundleResult } from './bundle';
import type { SiteConfig } from './server/router';
import type { RouteHandler } from './Handler';

const BUNDLES_DIR = 'bundles';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function bundle(siteConfigModulePath: string): Promise<BundleResult> {
  await mkdir(BUNDLES_DIR, { recursive: true });
  const site: SiteConfig = (await import(siteConfigModulePath)).default;
  const rootDir = path.dirname(siteConfigModulePath);

  const handlersByRoute: Record<string, RouteHandler> = {};
  const input: Record<string, string> = {};
  const middleware = site.middleware ?? [];
  await Promise.all(Object.entries(site.routes).map(async ([routeName, routeConfig]) => {
    const handler: RouteHandler = (await import(path.resolve(rootDir, routeConfig.handler))).default;
    handlersByRoute[routeName] = handler;
    if (handler.type === 'page') {
      const entrypointPath = path.resolve(BUNDLES_DIR, `route-${routeName}.js`);
      await writeFile(entrypointPath, makeEntrypoint(routeConfig.handler, routeConfig.path, rootDir, middleware));
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
        SERVER_SIDE: 'false',
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

function makeEntrypoint(handler: string, routePath: string, routesDir: string, middleware: string[]) {
  const q = (s: string) => JSON.stringify(s);
  const absolutePagePath = path.resolve(routesDir, handler);
  const bootstrapPath = path.resolve(__dirname, 'client/bootstrap.ts');
  const middlewareImports = middleware.map((m, i) =>
    `import middleware${i} from ${q(path.resolve(routesDir, m))};\n`
  ).join('');
  const middlewareArray = `[${middleware.map((_, i) => `middleware${i}`).join(', ')}]`;
  return (
`import Page from ${q(absolutePagePath)};
${middlewareImports}import { bootstrap } from ${q(bootstrapPath)};
bootstrap(Page, ${q(routePath)}, ${middlewareArray});`
  );
}
