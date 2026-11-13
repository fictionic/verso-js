import { describe, test, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import { createHandlerChain } from '../core/common/handler/chain';
import { definePage } from '../core/common/handler/Page';
import { defineEndpoint } from '../core/common/handler/Endpoint';
import { defineMiddleware } from '../core/common/handler/Middleware';
import type { MiddlewareDefinition, Scope } from '../core/common/handler/Middleware';
import type { RouteHandlerDefinition, RouteHandlerType } from '../core/common/handler/RouteHandler';
import type { RouteMatch } from '../core/common/router';
import { VersoRequest } from '../core/common/VersoRequest';

const NO_ELEMENTS: ReactElement[] = [];

function buildChain<T extends RouteHandlerType, O extends {}, R extends {}>(
  def: RouteHandlerDefinition<T, O, R>,
  middleware: MiddlewareDefinition<Scope>[] = [],
) {
  const versoRequest = new VersoRequest(new Request('http://localhost/'));
  const route: RouteMatch = { routeName: 'test', params: {}, handler: 'H', method: 'GET' };
  return createHandlerChain(def, versoRequest, route, middleware);
}

describe('createHandlerChain', () => {
  describe('Basic chaining', () => {
    test('handler with no middleware: standardized methods return the handler values directly', async () => {
      const els: ReactElement[] = [];
      const def = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => els,
      }));
      const chain = buildChain(def);

      expect(await chain.getRouteDirective()).toEqual({ kind: 'ok' });
      expect(chain.getElements()).toBe(els);
    });

    test('single middleware wrapping getRouteDirective: next() calls the handler', async () => {
      const handlerDirective = vi.fn(() => ({ kind: 'ok' as const }));
      const def = definePage(() => ({
        getRouteDirective: handlerDirective,
        getElements: () => NO_ELEMENTS,
      }));
      const mw = defineMiddleware('all', () => ({
        getRouteDirective: async (next) => {
          const directive = await next();
          return directive;
        },
      }));
      const chain = buildChain(def, [mw]);

      expect(await chain.getRouteDirective()).toEqual({ kind: 'ok' });
      expect(handlerDirective).toHaveBeenCalledTimes(1);
    });

    test('single middleware not calling next(): short-circuits, handler never called', async () => {
      const handlerDirective = vi.fn(() => ({ kind: 'ok' as const }));
      const def = definePage(() => ({
        getRouteDirective: handlerDirective,
        getElements: () => NO_ELEMENTS,
      }));
      const mw = defineMiddleware('all', () => ({
        getRouteDirective: (_next) => ({ kind: 'status' as const, code: 418, hasBody: false }),
      }));
      const chain = buildChain(def, [mw]);

      expect(await chain.getRouteDirective()).toEqual({ kind: 'status', code: 418, hasBody: false });
      expect(handlerDirective).not.toHaveBeenCalled();
    });

    test('two middleware in order: outermost wraps innermost wraps handler', async () => {
      const order: string[] = [];
      const def = definePage(() => ({
        getRouteDirective: () => {
          order.push('handler');
          return { kind: 'ok' as const };
        },
        getElements: () => NO_ELEMENTS,
      }));
      const a = defineMiddleware('all', () => ({
        getRouteDirective: async (next) => {
          order.push('A-before');
          const directive = await next();
          order.push('A-after');
          return directive;
        },
      }));
      const b = defineMiddleware('all', () => ({
        getRouteDirective: async (next) => {
          order.push('B-before');
          const directive = await next();
          order.push('B-after');
          return directive;
        },
      }));
      const chain = buildChain(def, [a, b]);

      await chain.getRouteDirective();
      expect(order).toEqual(['A-before', 'B-before', 'handler', 'B-after', 'A-after']);
    });
  });

  describe('Method selectivity', () => {
    test('middleware defining only getRouteDirective does not interfere with getElements', async () => {
      const els: ReactElement[] = [];
      const def = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => els,
      }));
      const mw = defineMiddleware('all', () => ({
        getRouteDirective: (_next) => ({ kind: 'status' as const, code: 503, hasBody: false }),
      }));
      const chain = buildChain(def, [mw]);

      expect(chain.getElements()).toBe(els);
      expect(await chain.getRouteDirective()).toEqual({ kind: 'status', code: 503, hasBody: false });
    });

    test('middleware defining multiple methods wraps each one independently', async () => {
      const def = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' as const }),
        getTitle: () => 'orig-title',
        getElements: () => NO_ELEMENTS,
      }));
      // only 'page' scope can wrap getTitle. 'all' can only wrap shared methods.
      const mw = defineMiddleware('page', () => ({
        getRouteDirective: async (next) => {
          await next();
          return { kind: 'status' as const, code: 201, hasBody: true };
        },
        getTitle: async (next) => `${await next()}!`,
      }));
      const chain = buildChain(def, [mw]);

      expect(await chain.getRouteDirective()).toEqual({ kind: 'status', code: 201, hasBody: true });
      expect(await chain.getTitle()).toBe('orig-title!');
    });
  });

  describe('Scope filtering', () => {
    test('page-scoped middleware excluded from endpoint handler chain', async () => {
      const def = defineEndpoint(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getContentType: () => 'text/plain',
        getResponseData: () => 'body',
      }));
      const pageMw = defineMiddleware('page', () => ({
        getRouteDirective: (_next) => ({ kind: 'status' as const, code: 418, hasBody: false }),
      }));
      const chain = buildChain(def, [pageMw]);

      expect(await chain.getRouteDirective()).toEqual({ kind: 'ok' });
    });

    test('endpoint-scoped middleware excluded from page handler chain', async () => {
      const def = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => NO_ELEMENTS,
      }));
      const endpointMw = defineMiddleware('endpoint', () => ({
        getRouteDirective: (_next) => ({ kind: 'status' as const, code: 418, hasBody: false }),
      }));
      const chain = buildChain(def, [endpointMw]);

      expect(await chain.getRouteDirective()).toEqual({ kind: 'ok' });
    });

    test("scope 'all' middleware included in both page and endpoint chains", async () => {
      const allMw = defineMiddleware('all', () => ({
        getRouteDirective: (_next) => ({ kind: 'status' as const, code: 418, hasBody: false }),
      }));

      const pageDef = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => NO_ELEMENTS,
      }));
      const pageChain = buildChain(pageDef, [allMw]);
      expect(await pageChain.getRouteDirective()).toEqual({ kind: 'status', code: 418, hasBody: false });

      const endpointDef = defineEndpoint(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getContentType: () => 'text/plain',
        getResponseData: () => 'body',
      }));
      const endpointChain = buildChain(endpointDef, [allMw]);
      expect(await endpointChain.getRouteDirective()).toEqual({ kind: 'status', code: 418, hasBody: false });
    });
  });

  describe('Nested middleware', () => {
    test('middleware declaring its own middleware array: children are recursively expanded and run before the parent', async () => {
      const order: string[] = [];
      const def = definePage(() => ({
        getRouteDirective: () => {
          order.push('handler');
          return { kind: 'ok' as const };
        },
        getElements: () => NO_ELEMENTS,
      }));
      const child = defineMiddleware('all', () => ({
        getRouteDirective: async (next) => {
          order.push('child-before');
          const directive = await next();
          order.push('child-after');
          return directive;
        },
      }));
      const parent = defineMiddleware('all', () => ({
        middleware: [child],
        getRouteDirective: async (next) => {
          order.push('parent-before');
          const directive = await next();
          order.push('parent-after');
          return directive;
        },
      }));
      const chain = buildChain(def, [parent]);

      await chain.getRouteDirective();
      expect(order).toEqual([
        'child-before',
        'parent-before',
        'handler',
        'parent-after',
        'child-after',
      ]);
    });

    test('empty nested middleware array: no effect', async () => {
      const order: string[] = [];
      const def = definePage(() => ({
        getRouteDirective: () => {
          order.push('handler');
          return { kind: 'ok' as const };
        },
        getElements: () => NO_ELEMENTS,
      }));
      const mw = defineMiddleware('all', () => ({
        middleware: [],
        getRouteDirective: async (next) => {
          order.push('mw');
          return next();
        },
      }));
      const chain = buildChain(def, [mw]);

      await chain.getRouteDirective();
      expect(order).toEqual(['mw', 'handler']);
    });
  });

  describe('Config lifecycle', () => {
    test('addConfigValues declares a key and seeds its value; the handler reads it back', async () => {
      let observed: unknown;
      const def = definePage((ctx) => ({
        getRouteDirective: () => {
          observed = ctx.getConfigValue('flag');
          return { kind: 'ok' as const };
        },
        getElements: () => NO_ELEMENTS,
      }));
      const mw = defineMiddleware('all', () => ({
        addConfigValues: () => ({ flag: 'on' }),
      }));
      const chain = buildChain(def, [mw]);

      await chain.getRouteDirective();
      expect(observed).toBe('on');
    });

    test('a key declared with an undefined value reads back as undefined', async () => {
      let observed: unknown = 'sentinel';
      const def = definePage((ctx) => ({
        getRouteDirective: () => {
          observed = ctx.getConfigValue('foo');
          return { kind: 'ok' as const };
        },
        getElements: () => NO_ELEMENTS,
      }));
      const mw = defineMiddleware('all', () => ({
        addConfigValues: () => ({ foo: undefined }),
      }));
      const chain = buildChain(def, [mw]);

      await chain.getRouteDirective();
      expect(observed).toBeUndefined();
    });

    test("setConfigValues overrides a key declared elsewhere; the handler's override (applied last) wins", async () => {
      let observed: unknown;
      const def = definePage((ctx) => ({
        setConfigValues: () => ({ flag: 'from-handler' }),
        getRouteDirective: () => {
          observed = ctx.getConfigValue('flag');
          return { kind: 'ok' as const };
        },
        getElements: () => NO_ELEMENTS,
      }));
      const seeder = defineMiddleware('all', () => ({
        addConfigValues: () => ({ flag: 'seeded-default' }),
      }));
      const chain = buildChain(def, [seeder]);

      await chain.getRouteDirective();
      expect(observed).toBe('from-handler');
    });

    test('setConfigValues for a key not declared via addConfigValues throws', () => {
      const def = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => NO_ELEMENTS,
      }));
      const mw = defineMiddleware('all', () => ({
        setConfigValues: () => ({ unregistered: 'x' }),
      }));

      expect(() => buildChain(def, [mw])).toThrow(/uninitiated config key/);
    });

    test('multiple middleware each declare a different key: all are readable', async () => {
      const observed: Record<string, unknown> = {};
      const def = definePage((ctx) => ({
        getRouteDirective: () => {
          observed.a = ctx.getConfigValue('a');
          observed.b = ctx.getConfigValue('b');
          return { kind: 'ok' as const };
        },
        getElements: () => NO_ELEMENTS,
      }));
      const mwA = defineMiddleware('all', () => ({
        addConfigValues: () => ({ a: 'value-a' }),
      }));
      const mwB = defineMiddleware('all', () => ({
        addConfigValues: () => ({ b: 'value-b' }),
      }));
      const chain = buildChain(def, [mwA, mwB]);

      await chain.getRouteDirective();
      expect(observed).toEqual({ a: 'value-a', b: 'value-b' });
    });
  });

  describe('Defaults and standardization', () => {
    test('optional page methods not provided are filled with defaults (getTitle => null)', async () => {
      const def = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => NO_ELEMENTS,
      }));
      const chain = buildChain(def);

      expect(await chain.getTitle()).toBeNull();
      expect(await chain.getStylesheets()).toEqual([]);
      expect(await chain.getScripts()).toEqual([]);
      expect(await chain.getLinkTags()).toEqual([]);
      expect(await chain.getMetaTags()).toEqual([]);
      expect(await chain.getBodyClasses()).toEqual([]);
    });

    test('shared optional methods are defaulted too (getRouteDirective => ok, getHeaders => empty)', async () => {
      const def = definePage(() => ({
        getElements: () => NO_ELEMENTS,
      }));
      const chain = buildChain(def);

      expect(await chain.getRouteDirective()).toEqual({ kind: 'ok' });
      expect(chain.getHeaders()).toBeInstanceOf(Headers);
      expect([...chain.getHeaders().keys()]).toEqual([]);
    });

    test('defineMiddleware(init) defaults scope to "page"', () => {
      const mw = defineMiddleware(() => ({}));
      expect(mw.scope).toBe('page');
      expect(mw.type).toBe('middleware');
    });

    test("defineMiddleware('endpoint', init) uses the explicit scope", () => {
      const mw = defineMiddleware('endpoint', () => ({}));
      expect(mw.scope).toBe('endpoint');
      expect(mw.type).toBe('middleware');
    });
  });

  describe('Error handling', () => {
    test('middleware that throws: error propagates, handler not called', async () => {
      const handlerDirective = vi.fn(() => ({ kind: 'ok' as const }));
      const def = definePage(() => ({
        getRouteDirective: handlerDirective,
        getElements: () => NO_ELEMENTS,
      }));
      const mw = defineMiddleware('all', () => ({
        getRouteDirective: (_next) => {
          throw new Error('middleware boom');
        },
      }));
      const chain = buildChain(def, [mw]);

      await expect(async () => chain.getRouteDirective()).rejects.toThrow('middleware boom');
      expect(handlerDirective).not.toHaveBeenCalled();
    });

    test('middleware calling next() more than once throws', async () => {
      const handlerDirective = vi.fn(() => ({ kind: 'ok' as const }));
      const def = definePage(() => ({
        getRouteDirective: handlerDirective,
        getElements: () => NO_ELEMENTS,
      }));
      const mw = defineMiddleware('all', () => ({
        getRouteDirective: async (next) => {
          await next();
          return next();
        },
      }));
      const chain = buildChain(def, [mw]);

      await expect(chain.getRouteDirective()).rejects.toThrow(/next\(\) called more than once/);
      expect(handlerDirective).toHaveBeenCalledTimes(1);
    });

    test('the single-use next() guard is per-invocation: a composed method may be called more than once on the same chain', async () => {
      const def = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => NO_ELEMENTS,
      }));
      const mw = defineMiddleware('all', () => ({
        getRouteDirective: (next) => next(),
      }));
      const chain = buildChain(def, [mw]);

      expect(await chain.getRouteDirective()).toEqual({ kind: 'ok' });
      expect(await chain.getRouteDirective()).toEqual({ kind: 'ok' });
    });

    test('handler throws inside next(): middleware can catch and recover', async () => {
      const def = definePage(() => ({
        getRouteDirective: () => {
          throw new Error('handler boom');
        },
        getElements: () => NO_ELEMENTS,
      }));
      const mw = defineMiddleware('all', () => ({
        getRouteDirective: async (next) => {
          try {
            return await next();
          } catch {
            return { kind: 'status' as const, code: 500, hasBody: false };
          }
        },
      }));
      const chain = buildChain(def, [mw]);

      expect(await chain.getRouteDirective()).toEqual({ kind: 'status', code: 500, hasBody: false });
    });
  });
});
