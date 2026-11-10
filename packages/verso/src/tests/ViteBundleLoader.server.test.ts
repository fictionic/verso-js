import { describe, test, expect } from 'vitest';
import { Resolver } from '../core/common/resolver';
import { definePage } from '../core/common/handler/Page';
import { createViteBundleLoader } from '../build/ViteBundleLoader';
import type { RoutesMap } from '../build/config';
import type { Stylesheet } from '../core/common/handler/PageHeader';
import type { RouteHandlerDefinition, RouteHandlerType } from '../core/common/handler/RouteHandler';
import { withRLS } from '../userland/testing';

function makeRequest(path: string, method = 'GET'): Request {
  return new Request(`http://localhost${path}`, { method });
}

type AnyDef = RouteHandlerDefinition<RouteHandlerType, any, any>;

// The proxy chain is real definePage handlers: a → b → c, c renders.
// z is a standalone route for the baseline and isolation cases.
const handlers: Record<string, AnyDef> = {
  a: definePage(() => ({
    getRouteDirective: () => ({ kind: 'proxy', routeName: 'b' }),
    getElements: () => [],
  })),
  b: definePage(() => ({
    getRouteDirective: () => ({ kind: 'proxy', routeName: 'c' }),
    getElements: () => [],
  })),
  c: definePage(() => ({
    getRouteDirective: () => ({ kind: 'ok' }),
    getElements: () => [],
  })),
  z: definePage(() => ({
    getRouteDirective: () => ({ kind: 'ok' }),
    getElements: () => [],
  })),
};

// Every route in the chain must be a real RoutesMap entry that accepts GET —
// the proxy branch reads this.routes[proxiedRouteName] and runs routeAcceptsMethod.
const routes: RoutesMap = {
  a: { path: '/a', handler: 'A' },
  b: { path: '/b', handler: 'B' },
  c: { path: '/c', handler: 'C' },
  z: { path: '/z', handler: 'Z' },
};

const getRouteHandler = (name: string) => handlers[name] ?? null;

/**
 * Resolve `path` and return the resolved page handler's accumulated header
 * assets. Each call runs in its own fresh RLS scope.
 */
async function resolveAssets(
  bundleLoader: ReturnType<typeof createViteBundleLoader>,
  path: string,
): Promise<{ preloadHrefs: string[]; styleHrefs: string[] }> {
  const resolver = new Resolver(routes, getRouteHandler, [bundleLoader]);
  return withRLS(async () => {
    const res = await resolver.resolveRoute(makeRequest(path));
    if (res.kind !== 'response') throw new Error('expected response');
    if (res.handler?.type !== 'page') throw new Error('expected page handler');
    const links = await res.handler.getLinkTags();
    const styles = await res.handler.getStylesheets();
    const preloadHrefs = links
      .filter((l) => l.rel === 'modulepreload')
      .map((l) => l.href);
    const styleHrefs = styles
      .filter((s): s is Extract<Stylesheet, { href: string }> => 'href' in s)
      .map((s) => s.href);
    return { preloadHrefs, styleHrefs };
  });
}

function makeBundleLoader(overrides?: {
  scripts?: Record<string, string[]>;
  css?: Record<string, Stylesheet[]>;
}) {
  const scripts = overrides?.scripts ?? {
    a: ['/chunks/a.js'],
    b: ['/chunks/b.js'],
    c: ['/chunks/c.js'],
    z: ['/chunks/z.js'],
  };
  const css = overrides?.css ?? {
    a: [{ href: '/css/a.css' }],
    b: [{ href: '/css/b.css' }],
    c: [{ href: '/css/c.css' }],
    z: [{ href: '/css/z.css' }],
  };
  return createViteBundleLoader({
    getGlobalScripts: () => [],
    getGlobalStylesheets: () => [],
    getRouteScriptUrls: (name) => scripts[name] ?? [],
    getRouteStylesheets: (name) => css[name] ?? [],
  });
}

describe('Suite 29: proxy ↔ bundle-loader asset accumulation', () => {
  describe('Accumulation across the chain', () => {
    test('JS preloads cover every hop', async () => {
      const { preloadHrefs } = await resolveAssets(makeBundleLoader(), '/a');
      expect(preloadHrefs).toContain('/chunks/a.js');
      expect(preloadHrefs).toContain('/chunks/b.js');
      expect(preloadHrefs).toContain('/chunks/c.js');
    });

    test('order follows the chain', async () => {
      const { preloadHrefs } = await resolveAssets(makeBundleLoader(), '/a');
      expect(preloadHrefs).toEqual(['/chunks/a.js', '/chunks/b.js', '/chunks/c.js']);
    });
  });

  describe('Final-route-only CSS', () => {
    test("stylesheets are the final route's only", async () => {
      const { styleHrefs } = await resolveAssets(makeBundleLoader(), '/a');
      expect(styleHrefs).toContain('/css/c.css');
      expect(styleHrefs).not.toContain('/css/a.css');
      expect(styleHrefs).not.toContain('/css/b.css');
    });
  });

  describe('Dedup', () => {
    test('shared chunk preloaded once', async () => {
      const bundleLoader = makeBundleLoader({
        scripts: {
          a: ['/chunks/a.js'],
          b: ['/chunks/b.js', '/chunks/shared.js'],
          c: ['/chunks/c.js', '/chunks/shared.js'],
        },
      });
      const { preloadHrefs } = await resolveAssets(bundleLoader, '/a');
      const sharedCount = preloadHrefs.filter((h) => h === '/chunks/shared.js').length;
      expect(sharedCount).toBe(1);
      // distinct URLs are all still present
      expect(preloadHrefs).toContain('/chunks/a.js');
      expect(preloadHrefs).toContain('/chunks/b.js');
      expect(preloadHrefs).toContain('/chunks/c.js');
    });
  });

  describe('Non-proxy baseline', () => {
    test('direct route adds no noise', async () => {
      const { preloadHrefs, styleHrefs } = await resolveAssets(makeBundleLoader(), '/z');
      expect(preloadHrefs).toEqual(['/chunks/z.js']);
      expect(styleHrefs).toEqual(['/css/z.css']);
    });
  });

  describe('Request isolation', () => {
    test('routeNames resets per request', async () => {
      const bundleLoader = makeBundleLoader();
      // First request: the a → b → c chain (separate RLS scope).
      const chain = await resolveAssets(bundleLoader, '/a');
      expect(chain.preloadHrefs).toEqual(['/chunks/a.js', '/chunks/b.js', '/chunks/c.js']);
      // Second request: standalone z in its own RLS scope — nothing leaks in.
      const standalone = await resolveAssets(bundleLoader, '/z');
      expect(standalone.preloadHrefs).toEqual(['/chunks/z.js']);
      expect(standalone.preloadHrefs).not.toContain('/chunks/a.js');
      expect(standalone.preloadHrefs).not.toContain('/chunks/b.js');
      expect(standalone.preloadHrefs).not.toContain('/chunks/c.js');
    });
  });
});
