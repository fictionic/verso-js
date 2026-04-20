import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {VersoConfig} from './config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOOTSTRAP_PATH = path.resolve(__dirname, 'bootstrap.js');
const SERVER_PATH = path.resolve(__dirname, 'build.js');

export interface EntrypointGenerator {
  generateHandlerClientEntrypoint(): string;
  generateServerEntrypoint(): string;
}

export function getEntrypointGenerator(
  handlerBasePath: string,
  versoConfig: VersoConfig,
  writeManifest: boolean,
): EntrypointGenerator {

  const { routes, middleware, server: serverSettings } = versoConfig;
  const middlewarePaths = (middleware ?? [])
    .map((modulePath) => path.resolve(handlerBasePath, modulePath));

  return {
    generateHandlerClientEntrypoint(): string {
      const pageImporterEntries = Object.entries(routes)
        .map(([routeName, routeConfig]) => {
          // clientside, we generate lazy-loaders so each page is only imported when routed to
          const absolutePagePath = path.resolve(handlerBasePath, routeConfig.handler);
          return `${quote(routeName)}: () => import(${quote(absolutePagePath)})`;
        });

      const {
        importStatements: middlewareImportStatements,
        importNames: middlewareImportNames,
      } = generateStaticImports(middlewarePaths, 'middleware');

      const manifest = writeManifest ?
        "await import(/* @vite-ignore */ '/bundles/manifest.js?v=' + __BUILD_ID__).then(m => m.default)" : // we've preloaded this so it should be instant
        "null"; // not needed in dev mode -- vite handles css on client transitions

      return `
import { bootstrap } from ${quote(BOOTSTRAP_PATH)};

const routes = ${JSON.stringify(routes)};

const pageLoaders = {
  ${pageImporterEntries.join(',\n  ')}
};

${middlewareImportStatements.join('\n')}
const middleware = [${middlewareImportNames.join(', ')}];

const manifest = ${manifest};

bootstrap(routes, pageLoaders, middleware, manifest);
`.trim();
    },

    generateServerEntrypoint(): string {
      const routeHandlerArray = Object.entries(routes)
        .map(([routeName, routeConfig]) => {
          return {
            routeName,
            modulePath: path.resolve(handlerBasePath, routeConfig.handler),
          };
        });
      const routeHandlerModulePaths = routeHandlerArray.map(({ modulePath }) => modulePath);
      const {
        importStatements: routeHandlerImportStatements,
        importNames: routeHandlerImportNames,
      } = generateStaticImports(routeHandlerModulePaths, 'handler');
      const routeHandlerImportEntries = routeHandlerArray
        .map(({ routeName }, i) => `${quote(routeName)}: ${routeHandlerImportNames[i]}`);

      const {
        importStatements: middlewareImportStatements,
        importNames: middlewareImportNames,
      }  = generateStaticImports(middlewarePaths, 'middleware');

      return `
import { createVersoServer } from ${quote(SERVER_PATH)};

const routes = ${JSON.stringify(routes)};

${routeHandlerImportStatements.join('\n')}
const routeHandlers = {
  ${routeHandlerImportEntries.join(',\n  ')}
};

${middlewareImportStatements.join('\n')}
const middleware = [${middlewareImportNames.join(',\n')}];

const serverSettings = ${JSON.stringify(serverSettings)};

export async function getServer(bundleResult) {
  return createVersoServer(
    routes,
    routeHandlers,
    middleware,
    bundleResult,
    serverSettings,
  );
}

export function getSettings() {
  return serverSettings;
}
`.trim();
    }
  };
};

function quote(s: string) {
  return JSON.stringify(s);
}

type StaticImports = {
  importStatements: string[];
  importNames: string[];
};
function generateStaticImports(modulePaths: string[], key: string): StaticImports {
  const importStatements: string[] = [];
  const importNames: string[] = [];
  modulePaths.forEach((modulePath, i) => {
    const importName = `${key}_${i}`;
    importNames.push(importName);
    importStatements.push(`import ${importName} from ${quote(modulePath)};`);
  });
  return {
    importStatements,
    importNames,
  };
}

