import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Routes } from './server/router';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default bootstrap path, correct when this module runs from source (not bundled). */
const DEFAULT_BOOTSTRAP_PATH = path.resolve(__dirname, 'client/bootstrap.ts');

export function makeUnifiedEntrypoint(
  pageRouteNames: string[],
  routes: Routes,
  routesDir: string,
  siteConfigPath: string,
  bootstrapPath: string = DEFAULT_BOOTSTRAP_PATH,
): string {
  const q = (s: string) => JSON.stringify(s);

  const loaderEntries = pageRouteNames.map(name => {
    const absoluteHandlerPath = path.resolve(routesDir, routes[name]!.handler);
    return `  ${q(name)}: () => import(${q(absoluteHandlerPath)})`;
  });

  return (
`import siteConfig from ${q(siteConfigPath)};
import { bootstrap } from ${q(bootstrapPath)};

const pageLoaders = {
${loaderEntries.join(',\n')}
};

bootstrap(siteConfig, pageLoaders);`
  );
}
