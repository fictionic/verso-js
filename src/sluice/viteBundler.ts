import path from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { BundleManifest, BundleResult } from './bundle';
import type { SluiceRoutes } from './server/router';

const BUNDLES_DIR = 'bundles';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function bundle(routesModulePath: string): Promise<BundleResult> {
  await mkdir(BUNDLES_DIR, { recursive: true });
  const routes: SluiceRoutes = (await import(routesModulePath)).default;
  const routesDir = path.dirname(routesModulePath);

  const input: Record<string, string> = {};
  await Promise.all(Object.entries(routes).map(async ([routeName, { page, path: routePath }]) => {
    const entrypointPath = path.resolve(BUNDLES_DIR, `route-${routeName}.js`);
    await writeFile(entrypointPath, makeEntrypoint(page, routePath, routesDir));
    input[routeName] = entrypointPath;
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

    return { manifest, bundleContents };
  } finally {
    await rm(BUNDLES_DIR, { recursive: true }).catch(() => {});
  }
}

function makeEntrypoint(page: string, routePath: string, routesDir: string) {
  const absolutePagePath = path.resolve(routesDir, page);
  const bootstrapPath = path.resolve(__dirname, 'client/bootstrap.ts');
  return (
`import Page from "${absolutePagePath}";
import { bootstrap } from "${bootstrapPath}";
bootstrap(Page, "${routePath}");`
  );
}
