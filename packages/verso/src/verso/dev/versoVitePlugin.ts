import type { Plugin } from 'vite';
import type { Routes } from '../server/router';
import { makeEntrypoint } from '../entrypoint';
import path from 'node:path';

const VIRTUAL_PREFIX = 'virtual:verso/route-';
const RESOLVED_PREFIX = '\0' + VIRTUAL_PREFIX;

export function versoVitePlugin(getRoutes: () => Routes, siteConfigPath: string): Plugin {
  const routesDir = path.dirname(siteConfigPath);

  return {
    name: '@verso-js/verso',

    resolveId(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) {
        return RESOLVED_PREFIX + id.slice(VIRTUAL_PREFIX.length);
      }
    },

    load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return;
      const routeName = id.slice(RESOLVED_PREFIX.length);
      const routeConfig = getRoutes()[routeName];
      if (!routeConfig) return;
      return makeEntrypoint(routeConfig.handler, routesDir, siteConfigPath);
    },
  };
}

export function virtualModuleId(routeName: string): string {
  return VIRTUAL_PREFIX + routeName;
}
