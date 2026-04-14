import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoutesMap } from '../core/router';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BOOTSTRAP_PATH = path.resolve(__dirname, 'bootstrap.js');

export function makeUnifiedEntrypoint(
  pageRouteNames: string[],
  routes: RoutesMap,
  routesDir: string,
  siteConfigPath: string,
  bootstrapPath: string = DEFAULT_BOOTSTRAP_PATH, // TODO: is this needed?
  isBuild: boolean,
): string {
  const q = (s: string) => JSON.stringify(s);

  const loaderEntries = pageRouteNames.map(name => {
    const absoluteHandlerPath = path.resolve(routesDir, routes[name]!.handler);
    return `  ${q(name)}: () => import(${q(absoluteHandlerPath)})`;
  });

  const manifest = isBuild ?
    "await import(/* @vite-ignore */ '/bundles/manifest.js?v=' + __BUILD_ID__).then(m => m.default)" : // we've preloaded this so it should be instant
    "null"; // not needed in dev mode -- vite handles css on client transitions

  return (
`import siteConfig from ${q(siteConfigPath)};
import { bootstrap } from ${q(bootstrapPath)};

const pageLoaders = {
${loaderEntries.join(',\n')}
};


const manifest = ${manifest};

bootstrap(siteConfig, pageLoaders, manifest);`
  );
}

export function makeServerEntry(siteConfigModulePath: string, routes: RoutesMap, distRoot: string): string {
  const rootDir = path.dirname(siteConfigModulePath);
  const createVersoServerPath = path.resolve(distRoot, 'build.js');
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
