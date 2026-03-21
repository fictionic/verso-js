import path from 'node:path';
import { unlink, mkdir } from 'node:fs/promises';
import type {BundleManifest, BundleResult} from './bundle';
import type {SluiceRoutes} from './server/router';

const BUNDLES_DIR = 'bundles';

export async function bundle(routesModulePath: string): Promise<BundleResult> {
  await mkdir(BUNDLES_DIR, { recursive: true });
  const routes: SluiceRoutes = (await import(routesModulePath)).default;
  const routesDir = path.dirname(routesModulePath);
  const routeNameByEntrypointPath = new Map<string,string>();
  const entrypoints = await Promise.all(Object.entries(routes).map(async ([routeName, { page, path: routePath }]) => {
    const entrypointPath = `${BUNDLES_DIR}/route-${routeName}.js`;
    routeNameByEntrypointPath.set(entrypointPath, routeName);
    await Bun.write(entrypointPath, makeEntrypoint(page, routePath, routesDir));
    return entrypointPath;
  }));

  try {
    const result = await Bun.build({
      entrypoints,
      target: 'browser',
      splitting: true,
      minify: false,
      metafile: true,
      define: { 'SERVER_SIDE': 'false' },
    });

    if (!result.success) {
      for (const msg of result.logs) console.error(msg);
      throw new Error('Client bundle build failed');
    }

    console.log("metafile", result.metafile);

    const manifest: BundleManifest = Object.assign({}, ...Object.entries(result.metafile!.outputs).map(([bundlePath, output]) => {
      if (output.entryPoint) {
        const routeName = routeNameByEntrypointPath.get(output.entryPoint)!;
        return {
          [routeName]: {
            scripts: [...output.imports.map(i => path.normalize(i.path)), path.normalize(bundlePath)],
            stylesheets: output.cssBundle ? [path.normalize(output.cssBundle)] : [],
          },
        };
      }
    }));

    const bundles: Record<string, string> = {};
    for (const artifact of result.outputs) {
      bundles[path.normalize(artifact.path)] = await artifact.text();
    }

    return {
      manifest,
      bundleContents: bundles,
    };
  } finally {
    await unlink(BUNDLES_DIR).catch(() => {});
  }
}

function makeEntrypoint(page: string, routePath: string, routesDir: string) {
  const absolutePagePath = path.resolve(routesDir, page);
  return (
`import Page from "${absolutePagePath}";
import { bootstrap } from ${JSON.stringify(import.meta.dir + '/client/bootstrap.ts')};
bootstrap(Page, "${routePath}");`
  );
}
