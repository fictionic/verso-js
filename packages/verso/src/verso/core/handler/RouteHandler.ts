import type {BaseConfig} from "./ResponderConfig";
import type {MiddlewareDefinition, Scope} from "./Middleware";
import type {RouteHandlerCtx} from "./RouteHandlerCtx";

export type MaybePromise<T> = T | Promise<T>;

export type RouteHandlerType = 'page' | 'endpoint';

export type RouteDirective = {
  status: number;
  redirectLocation?: string;
  hasDocument?: boolean;
} /* TODO | {
  proxyRoute: string;
}; */

export interface SharedRequiredMethods {
  getRouteDirective(): MaybePromise<RouteDirective>;
};

export interface SharedOptionalMethods {
  getHeaders(): Headers[];
};

export interface SharedMethods extends SharedRequiredMethods, Partial<SharedOptionalMethods> {};

export interface SharedHooks {
  setConfigValues(): Partial<BaseConfig>;
};

export interface MiddlewareDepender<S extends Scope> {
  middleware: MiddlewareDefinition<S | 'all'>[];
};

export interface BaseResponder<S extends Scope> extends MiddlewareDepender<S>, SharedHooks {};

export type RouteHandler<
  T extends RouteHandlerType,
  OptionalMethods extends {},
  RequiredMethods extends {},
> = Partial<BaseResponder<T>> &
  SharedMethods &
  Partial<OptionalMethods> &
  RequiredMethods;

type RouteHandlerFor<T extends RouteHandlerType> = RouteHandler<T, {}, {}>;

export type RouteHandlerInit<T extends RouteHandlerType, H extends RouteHandlerFor<T>> = (ctx: RouteHandlerCtx) => H;

export interface RouteHandlerDefinition<
  T extends RouteHandlerType,
  OptionalMethods extends {},
  RequiredMethods extends {},
> {
  type: T;
  init: RouteHandlerInit<T, RouteHandler<T, OptionalMethods, RequiredMethods>>;
  standardize: (handler: RouteHandler<RouteHandlerType, OptionalMethods, RequiredMethods>) => StandardizedRouteHandler<OptionalMethods, RequiredMethods>;
  // ^ not paramaterizing handler on T because then it would become contravariant on T which breaks the call to createHandlerChain
}

export function defineRouteHandler<
  T extends RouteHandlerType,
  OptionalMethods extends {},
  RequiredMethods extends {},
>(
  type: T,
  init: RouteHandlerInit<T, RouteHandler<T, OptionalMethods, RequiredMethods>>,
  defaults: OptionalMethods,
  requiredNames: (keyof RequiredMethods)[],
): RouteHandlerDefinition<T, OptionalMethods, RequiredMethods> {
  const standardize = makeStandardizer(defaults, requiredNames);
  return {
    type,
    init,
    standardize,
  };
}

function makeStandardizer<OptionalMethods extends {}, RequiredMethods extends {}>(
  defaults: OptionalMethods,
  requiredNames: (keyof RequiredMethods)[],
) {
  return (handler: RouteHandler<RouteHandlerType, OptionalMethods, RequiredMethods>) => {
    const methodNames = [
      ...Object.keys(SHARED_OPTIONAL_METHOD_DEFAULTS),
      ...SHARED_REQUIRED_METHOD_NAMES,
      ...Object.keys(defaults),
      ...requiredNames,
    ];
    return {
      ...SHARED_OPTIONAL_METHOD_DEFAULTS,
      ...defaults,
      ...Object.assign(
        {},
        ...Object.entries(handler)
          .filter(([ name ]) => methodNames.includes(name))
          .map(([ name, method ]) => ({ [name]: method }))
      ),
    } as StandardizedRouteHandler<OptionalMethods, RequiredMethods>;
  }
}

const SHARED_REQUIRED_METHOD_NAMES: (keyof SharedRequiredMethods)[] = ['getRouteDirective'];

const SHARED_OPTIONAL_METHOD_DEFAULTS: SharedOptionalMethods = {
  getHeaders: () => [],
};

export type StandardizedRouteHandler<
  OptionalMethods extends {},
  RequiredMethods extends {},
> = SharedOptionalMethods & SharedRequiredMethods & OptionalMethods & RequiredMethods;
