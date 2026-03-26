import type {MiddlewareDefinition, Middleware, Scope} from "../Middleware";
import type {RouteHandlerDefinition, RouteHandlerType, StandardizedRouteHandler} from "../RouteHandler";
import type {ResponderConfig} from "./ResponderConfig";
import type {RouteHandlerCtx} from "./RouteHandlerCtx";

export function createHandlerChain<T extends RouteHandlerType, OptionalMethods extends {}, RequiredMethods extends {}>(
  type: T,
  def: RouteHandlerDefinition<T, OptionalMethods, RequiredMethods>,
  globalMiddleware: MiddlewareDefinition<Scope>[],
  config: ResponderConfig,
  ctx: RouteHandlerCtx,
): StandardizedRouteHandler<OptionalMethods, RequiredMethods> {
  const handler = def.init(ctx);

  const baseMiddleware = [...globalMiddleware, ...(handler.middleware ?? [])];
  const allMiddleware = recursivelyExpandMiddleware(baseMiddleware, ctx, type);
  allMiddleware.forEach((m) => {
    const addValues = m.addConfigValues?.();
    if (addValues) {
      config.addValues(addValues);
    }
  });
  [...allMiddleware, handler].forEach((r) => {
    const setValues = r.setConfigValues?.();
    if (setValues) {
      config.setValues(setValues);
    }
  });

  const base = def.standardize(handler);
  return allMiddleware.reduceRight((chain, link) => {
    const result = { ...chain };
    for (const methodName of Object.keys(base)) {
      // no way to do this without `as any` because of the correlated union problem
      const current = (link as any)[methodName];
      if (current) {
        const next = (chain as any)[methodName];
        (result as any)[methodName] = current.bind(null, next);
      }
    }
    return result;
  }, base);

}

function recursivelyExpandMiddleware<R extends RouteHandlerType>(
  middlewareDefs: MiddlewareDefinition<Scope>[],
  ctx: RouteHandlerCtx,
  handlerType: R,
): Middleware<R>[] {
  if (middlewareDefs.length === 0) {
    return [];
  }
  return middlewareDefs
    .filter((def): def is MiddlewareDefinition<R> => def.scope === 'all' || def.scope === handlerType)
    .flatMap(def => {
      const m = def.init(ctx);
      const children = recursivelyExpandMiddleware(m.middleware ?? [], ctx, handlerType);
      return [...children, m];
    });
}


