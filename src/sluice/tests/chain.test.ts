import { test, expect, describe } from 'vitest';
import { createHandlerChain } from '@/sluice/core/chain';
import { defineRouteHandler, type RouteHandler } from '@/sluice/RouteHandler';
import { defineMiddleware } from '@/sluice/Middleware';
import { ResponderConfig } from '@/sluice/core/ResponderConfig';
import { startRequest } from '@/sluice/util/requestLocal';
import type {RouteHandlerCtx} from '../core/RouteHandlerCtx';

// --- Helpers ---

const DUMMY_FNS: RouteHandlerCtx = {
  getConfig: () => undefined as any,
  getRequest: () => undefined as any,
};

interface TestOptionalMethods {
  getTitle(): string;
}

interface TestRequiredMethods {
  getElements(): string[];
}

const TEST_OPTIONAL_DEFAULTS: TestOptionalMethods = {
  getTitle: () => '',
};

const TEST_REQUIRED_NAMES: (keyof TestRequiredMethods)[] = ['getElements'];

function inRequest<T>(fn: () => T): T {
  return startRequest(fn);
}

// --- Tests ---

describe('createHandlerChain', () => {

  test('returns standardized handler with defaults for omitted optional methods', () => {
    inRequest(() => {
      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => ({ status: 200 }),
          getElements: () => ['el'],
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );
      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [], config, DUMMY_FNS);

      expect(chain.getTitle()).toBe('');
      expect(chain.getElements()).toEqual(['el']);
      expect(chain.getRouteDirective()).toEqual({ status: 200 });
      expect(chain.getHeaders()).toEqual([]);
    });
  });

  test('handler-provided optional methods override defaults', () => {
    inRequest(() => {
      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => ({ status: 200 }),
          getElements: () => ['el'],
          getTitle: () => 'My Title',
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );
      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [], config, DUMMY_FNS);

      expect(chain.getTitle()).toBe('My Title');
    });
  });

  test('strips non-method properties (hooks) from standardized output', () => {
    inRequest(() => {
      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => ({ status: 200 }),
          getElements: () => ['el'],
          middleware: [],
          setConfigValues: () => ({}),
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );
      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [], config, DUMMY_FNS);

      expect(chain).not.toHaveProperty('middleware');
      expect(chain).not.toHaveProperty('setConfigValues');
    });
  });

  test('single middleware wraps handler methods via next()', () => {
    inRequest(() => {
      const callOrder: string[] = [];

      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => { callOrder.push('handler'); return { status: 200 }; },
          getElements: () => { callOrder.push('handler-elements'); return ['el']; },
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const mw = defineMiddleware('page', () => ({
        getRouteDirective: (next) => { callOrder.push('mw-before'); const r = next(); callOrder.push('mw-after'); return r; },
      }));

      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [mw], config, DUMMY_FNS);

      const result = chain.getRouteDirective();
      expect(result).toEqual({ status: 200 });
      expect(callOrder).toEqual(['mw-before', 'handler', 'mw-after']);

      // getElements not wrapped by this middleware, so handler called directly
      callOrder.length = 0;
      chain.getElements();
      expect(callOrder).toEqual(['handler-elements']);
    });
  });

  test('multiple middleware execute in definition order (outer first)', () => {
    inRequest(() => {
      const callOrder: string[] = [];

      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => { callOrder.push('handler'); return { status: 200 }; },
          getElements: () => [],
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const outer = defineMiddleware('page', () => ({
        getRouteDirective: (next) => { callOrder.push('outer-before'); const r = next(); callOrder.push('outer-after'); return r; },
      }));

      const inner = defineMiddleware('page', () => ({
        getRouteDirective: (next) => { callOrder.push('inner-before'); const r = next(); callOrder.push('inner-after'); return r; },
      }));

      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [outer, inner], config, DUMMY_FNS);

      chain.getRouteDirective();
      expect(callOrder).toEqual([
        'outer-before', 'inner-before', 'handler', 'inner-after', 'outer-after',
      ]);
    });
  });

  test('middleware can short-circuit by not calling next()', () => {
    inRequest(() => {
      let handlerCalled = false;

      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => { handlerCalled = true; return { status: 200 }; },
          getElements: () => [],
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const mw = defineMiddleware('page', () => ({
        getRouteDirective: (_next) => ({ status: 302, redirectLocation: '/login' }),
      }));

      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [mw], config, DUMMY_FNS);

      const result = chain.getRouteDirective();
      expect(result).toEqual({ status: 302, redirectLocation: '/login' });
      expect(handlerCalled).toBe(false);
    });
  });

  test('scope filtering: page middleware excluded from endpoint chains', () => {
    inRequest(() => {
      const callOrder: string[] = [];

      const def = defineRouteHandler(
        'endpoint',
        () => ({
          getRouteDirective: () => { callOrder.push('handler'); return { status: 200 }; },
          getContentType: () => 'application/json',
          getResponseData: () => '{}',
        }),
        {},
        ['getContentType', 'getResponseData'] as any,
      );

      const pageMw = defineMiddleware('page', () => ({
        getRouteDirective: (next) => { callOrder.push('page-mw'); return next(); },
      }));

      const config = new ResponderConfig();
      // pageMw has scope 'page', so it should be filtered out for endpoint chain
      const chain = createHandlerChain('endpoint', def, [pageMw as any], config, DUMMY_FNS);

      chain.getRouteDirective();
      expect(callOrder).toEqual(['handler']);
    });
  });

  test('scope filtering: "all" middleware included in both page and endpoint chains', () => {
    inRequest(() => {
      const callOrder: string[] = [];

      const pageDef = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => { callOrder.push('page-handler'); return { status: 200 }; },
          getElements: () => [],
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const endpointDef = defineRouteHandler(
        'endpoint',
        () => ({
          getRouteDirective: () => { callOrder.push('endpoint-handler'); return { status: 200 }; },
          getContentType: () => 'text/plain',
          getResponseData: () => 'ok',
        }),
        {},
        ['getContentType', 'getResponseData'] as any,
      );

      const allMw = defineMiddleware('all', () => ({
        getRouteDirective: (next) => { callOrder.push('all-mw'); return next(); },
      }));

      const config1 = new ResponderConfig();
      createHandlerChain('page', pageDef, [allMw], config1, DUMMY_FNS).getRouteDirective();
      expect(callOrder).toEqual(['all-mw', 'page-handler']);

      callOrder.length = 0;
      const config2 = new ResponderConfig();
      createHandlerChain('endpoint', endpointDef, [allMw as any], config2, DUMMY_FNS).getRouteDirective();
      expect(callOrder).toEqual(['all-mw', 'endpoint-handler']);
    });
  });

  test('handler-declared middleware is appended after global middleware', () => {
    inRequest(() => {
      const callOrder: string[] = [];

      const handlerMw = defineMiddleware('page', () => ({
        getRouteDirective: (next) => { callOrder.push('handler-mw'); return next(); },
      }));

      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => { callOrder.push('handler'); return { status: 200 }; },
          getElements: () => [],
          middleware: [handlerMw],
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const globalMw = defineMiddleware('page', () => ({
        getRouteDirective: (next) => { callOrder.push('global-mw'); return next(); },
      }));

      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [globalMw], config, DUMMY_FNS);

      chain.getRouteDirective();
      // global first, then handler-declared, then handler
      expect(callOrder).toEqual(['global-mw', 'handler-mw', 'handler']);
    });
  });

  test('recursive middleware expansion: sub-middleware of middleware are included', () => {
    inRequest(() => {
      const callOrder: string[] = [];

      const subMw = defineMiddleware('page', () => ({
        getRouteDirective: (next) => { callOrder.push('sub-mw'); return next(); },
      }));

      const parentMw = defineMiddleware('page', () => ({
        getRouteDirective: (next) => { callOrder.push('parent-mw'); return next(); },
        middleware: [subMw],
      }));

      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => { callOrder.push('handler'); return { status: 200 }; },
          getElements: () => [],
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [parentMw], config, DUMMY_FNS);

      chain.getRouteDirective();
      // sub-middleware comes before its parent (children first in flatMap)
      expect(callOrder).toEqual(['sub-mw', 'parent-mw', 'handler']);
    });
  });

  test('config: addConfigValues called on middleware before setConfigValues on all', () => {
    inRequest(() => {
      const callOrder: string[] = [];

      const mw = defineMiddleware('page', () => ({
        addConfigValues: () => { callOrder.push('mw-add'); return { showHeader: true }; },
        setConfigValues: () => { callOrder.push('mw-set'); return { showHeader: false }; },
      }));

      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => ({ status: 200 }),
          getElements: () => [],
          setConfigValues: () => { callOrder.push('handler-set'); return { showHeader: true }; },
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const config = new ResponderConfig();
      createHandlerChain('page', def, [mw], config, DUMMY_FNS);

      // addConfigValues on all middleware first, then setConfigValues on middleware+handler
      expect(callOrder).toEqual(['mw-add', 'mw-set', 'handler-set']);
    });
  });

  test('ctx object is passed to handler and middleware init', () => {
    inRequest(() => {
      const receivedFns: RouteHandlerCtx[] = [];

      const mw = defineMiddleware('page', (ctx) => {
        receivedFns.push(ctx);
        return {};
      });

      const def = defineRouteHandler(
        'page',
        (ctx) => {
          receivedFns.push(ctx);
          return {
            getRouteDirective: () => ({ status: 200 }),
            getElements: () => [],
          };
        },
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const config = new ResponderConfig();
      const ctx: RouteHandlerCtx = { getConfig: config.getValue, getRequest: () => undefined as any };
      createHandlerChain('page', def, [mw], config, ctx);

      expect(receivedFns).toHaveLength(2);
      expect(receivedFns[0]).toBe(ctx); // handler init gets fns
      expect(receivedFns[1]).toBe(ctx); // middleware init gets fns
    });
  });

  test('middleware can wrap multiple methods independently', () => {
    inRequest(() => {
      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => ({ status: 200 }),
          getElements: () => ['original'],
          getTitle: () => 'Original',
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const mw = defineMiddleware('page', () => ({
        getRouteDirective: (next) => {
          const result = next();
          return { ...result, status: 201 };
        },
        getElements: (next) => [...next(), 'injected' as any],
      }));

      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [mw], config, DUMMY_FNS);

      expect(chain.getRouteDirective()).toEqual({ status: 201 });
      expect(chain.getElements()).toEqual(['original', 'injected']);
      // getTitle not wrapped, uses handler value
      expect(chain.getTitle()).toBe('Original');
    });
  });

  test('async handleRoute works through middleware chain', async () => {
    await inRequest(async () => {
      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: async () => {
            await new Promise(r => setTimeout(r, 1));
            return { status: 200 };
          },
          getElements: () => [],
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const mw = defineMiddleware('page', () => ({
        getRouteDirective: async (next) => {
          const result = await next();
          return { ...result, hasDocument: true };
        },
      }));

      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [mw], config, DUMMY_FNS);

      const result = await chain.getRouteDirective();
      expect(result).toEqual({ status: 200, hasDocument: true });
    });
  });

  test('chain with no middleware returns standardized handler directly', () => {
    inRequest(() => {
      const def = defineRouteHandler(
        'page',
        () => ({
          getRouteDirective: () => ({ status: 404 }),
          getElements: () => ['not-found'],
        }),
        TEST_OPTIONAL_DEFAULTS,
        TEST_REQUIRED_NAMES,
      );

      const config = new ResponderConfig();
      const chain = createHandlerChain('page', def, [], config, DUMMY_FNS);

      expect(chain.getRouteDirective()).toEqual({ status: 404 });
      expect(chain.getElements()).toEqual(['not-found']);
      expect(chain.getTitle()).toBe('');
      expect(chain.getHeaders()).toEqual([]);
    });
  });
});

// --- makeStandardizer (tested via defineRouteHandler().standardize) ---

function makeHandler(props: Record<string, any>): RouteHandler<'page', any, any> {
  return {
    getRouteDirective: () => ({ status: 200 }),
    ...props,
  };
}

describe('makeStandardizer', () => {

  test('includes shared required methods (getRouteDirective) from handler', () => {
    const getRouteDirective = () => ({ status: 201 });
    const def = defineRouteHandler('page', () => null as any, {}, []);
    const result = def.standardize(makeHandler({ getRouteDirective }));

    expect(result.getRouteDirective).toBe(getRouteDirective);
  });

  test('fills in shared optional method defaults (getHeaders)', () => {
    const def = defineRouteHandler('page', () => null as any, {}, []);
    const result = def.standardize(makeHandler({}));

    expect(result.getHeaders).toBeDefined();
    expect(result.getHeaders()).toEqual([]);
  });

  test('handler-provided getHeaders overrides the shared default', () => {
    const customHeaders = () => [new Headers({ 'x-custom': '1' })];
    const def = defineRouteHandler('page', () => null as any, {}, []);
    const result = def.standardize(makeHandler({ getHeaders: customHeaders }));

    expect(result.getHeaders).toBe(customHeaders);
  });

  test('fills in handler-specific optional method defaults', () => {
    const def = defineRouteHandler(
      'page',
      () => null as any,
      TEST_OPTIONAL_DEFAULTS,
      TEST_REQUIRED_NAMES,
    );
    const result = def.standardize(makeHandler({ getElements: () => [] }));

    expect(result.getTitle()).toBe('');
  });

  test('handler-provided optional methods override handler-specific defaults', () => {
    const def = defineRouteHandler(
      'page',
      () => null as any,
      TEST_OPTIONAL_DEFAULTS,
      TEST_REQUIRED_NAMES,
    );
    const getTitle = () => 'Custom';
    const result = def.standardize(makeHandler({ getElements: () => [], getTitle }));

    expect(result.getTitle).toBe(getTitle);
  });

  test('includes handler-specific required methods', () => {
    const def = defineRouteHandler(
      'page',
      () => null as any,
      TEST_OPTIONAL_DEFAULTS,
      TEST_REQUIRED_NAMES,
    );
    const getElements = () => ['a', 'b'];
    const result = def.standardize(makeHandler({ getElements }));

    expect(result.getElements).toBe(getElements);
  });

  test('strips middleware array from output', () => {
    const def = defineRouteHandler('page', () => null as any, TEST_OPTIONAL_DEFAULTS, TEST_REQUIRED_NAMES);
    const result = def.standardize(makeHandler({
      getElements: () => [],
      middleware: [{ type: 'middleware', scope: 'page', init: () => ({}) }],
    }));

    expect(result).not.toHaveProperty('middleware');
  });

  test('strips setConfigValues hook from output', () => {
    const def = defineRouteHandler('page', () => null as any, TEST_OPTIONAL_DEFAULTS, TEST_REQUIRED_NAMES);
    const result = def.standardize(makeHandler({
      getElements: () => [],
      setConfigValues: () => ({ foo: 'bar' }),
    }));

    expect(result).not.toHaveProperty('setConfigValues');
  });

  test('strips arbitrary non-whitelisted properties from output', () => {
    const def = defineRouteHandler('page', () => null as any, TEST_OPTIONAL_DEFAULTS, TEST_REQUIRED_NAMES);
    const result = def.standardize(makeHandler({
      getElements: () => [],
      somethingRandom: 'should be stripped',
      anotherThing: 42,
    }));

    expect(result).not.toHaveProperty('somethingRandom');
    expect(result).not.toHaveProperty('anotherThing');
  });

  test('output contains exactly the whitelisted keys and nothing else', () => {
    const def = defineRouteHandler('page', () => null as any, TEST_OPTIONAL_DEFAULTS, TEST_REQUIRED_NAMES);
    const result = def.standardize(makeHandler({
      getElements: () => [],
      getTitle: () => 'yes',
      middleware: [],
      setConfigValues: () => ({}),
      extraProp: true,
    }));

    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['getElements', 'getHeaders', 'getRouteDirective', 'getTitle'].sort());
  });

  test('works with no handler-specific optional or required methods (endpoint-like)', () => {
    const def = defineRouteHandler('endpoint', () => null as any, {}, []);
    const result = def.standardize(makeHandler({}));

    // Should have shared methods only
    expect(result.getRouteDirective).toBeDefined();
    expect(result.getHeaders).toBeDefined();
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['getHeaders', 'getRouteDirective'].sort());
  });

  test('uses handler method identity (not a copy)', () => {
    const getElements = () => ['el'];
    const def = defineRouteHandler('page', () => null as any, TEST_OPTIONAL_DEFAULTS, TEST_REQUIRED_NAMES);
    const result = def.standardize(makeHandler({ getElements }));

    // The actual function references should be preserved
    expect(result.getElements).toBe(getElements);
  });
});
