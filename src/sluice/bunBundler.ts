import path from 'node:path';
import { unlink, mkdir } from 'node:fs/promises';
import type {BundleManifest, BundleResult} from './bundle';
import type {SiteConfig} from './server/router';
import type {RouteHandlerDefinition} from './RouteHandler';

const BUNDLES_DIR = 'bundles';

export async function bundle(siteConfigModulePath: string): Promise<BundleResult> {
  await mkdir(BUNDLES_DIR, { recursive: true });
  const site: SiteConfig = (await import(siteConfigModulePath)).default;
  const rootDir = path.dirname(siteConfigModulePath);

  const handlers: Record<string, RouteHandlerDefinition<any, any, any>> = {};
  const routeNameByEntrypointPath = new Map<string, string>();
  const entrypoints: string[] = [];
  await Promise.all(Object.entries(site.routes).map(async ([routeName, routeConfig]) => {
    const handler: RouteHandlerDefinition<any, any, any> = (await import(path.resolve(rootDir, routeConfig.handler))).default;
    handlers[routeName] = handler;
    if (handler.type === 'page') {
      const entrypointPath = `${BUNDLES_DIR}/route-${routeName}.js`;
      routeNameByEntrypointPath.set(entrypointPath, routeName);
      await Bun.write(entrypointPath, makeEntrypoint(routeConfig.handler, routeConfig.path, rootDir, siteConfigModulePath));
      entrypoints.push(entrypointPath);
    }
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
      handlersByRoute: handlers,
    };
  } finally {
    await unlink(BUNDLES_DIR).catch(() => {});
  }
}

function makeEntrypoint(handler: string, routePath: string, routesDir: string, siteConfigPath: string) {
  const absolutePagePath = path.resolve(routesDir, handler);
  return (
`import siteConfig from ${JSON.stringify(siteConfigPath)};
import Page from "${absolutePagePath}";
import { bootstrap } from ${JSON.stringify(import.meta.dir + '/client/bootstrap.ts')};
bootstrap(Page, "${routePath}", siteConfig.middleware ?? []);`
  );
}
