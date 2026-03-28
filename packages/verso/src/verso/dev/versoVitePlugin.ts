import type { Plugin } from 'vite';
import type { Routes } from '../server/router';
import { makeUnifiedEntrypoint } from '../entrypoint';
import path from 'node:path';

const VIRTUAL_ID = 'virtual:verso/entry';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

export function versoVitePlugin(getRoutes: () => Routes, siteConfigPath: string): Plugin {
  const routesDir = path.dirname(siteConfigPath);

  return {
    name: '@verso-js/verso',

    resolveId(id) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_ID;
      }
    },

    load(id) {
      if (id !== RESOLVED_ID) return;
      const routes = getRoutes();
      // Include all routes in the loader map — endpoints are dead code since
      // the entry <script> is only injected for page routes.
      const allRouteNames = Object.keys(routes);
      return makeUnifiedEntrypoint(allRouteNames, routes, routesDir, siteConfigPath);
    },
  };
}

export function virtualEntryId(): string {
  return VIRTUAL_ID;
}
