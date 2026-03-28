import type {SharedMethods, BaseResponder, RouteHandlerType} from "./RouteHandler";
import type {BaseConfig} from "./ResponderConfig";
import type {PageOptionalMethods, PageRequiredMethods} from "./Page";
import type {EndpointRequiredMethods} from "./Endpoint";
import type {RouteHandlerCtx} from "./RouteHandlerCtx";

type HandlerMethodsMap = {
  page: PageOptionalMethods & PageRequiredMethods;
  endpoint: EndpointRequiredMethods;
  all: {};
};

type HandlerMethodsFor<S extends Scope> = HandlerMethodsMap[S];

type AllHandlerMethodKeys = {
  [S in keyof HandlerMethodsMap]: keyof HandlerMethodsMap[S]
}[keyof HandlerMethodsMap];

type ForbiddenMethodsMap = {
  [S in Scope]: {
    [K in AllHandlerMethodKeys as K extends keyof HandlerMethodsMap[S] ? never : K]?: never
  }
};

export type Scope = RouteHandlerType | 'all';

interface MiddlewareHooks {
  addConfigValues(): Partial<BaseConfig>;
}

export type Middleware<S extends Scope> =
  ForbiddenMethodsMap[S] &
  Partial<
    BaseResponder<S> &
    MiddlewareHooks &
    Chained<SharedMethods> &
    Chained<HandlerMethodsFor<S>>
  >;

type MiddlewareInit<S extends Scope> = (ctx: RouteHandlerCtx) => Middleware<S>;

export interface MiddlewareDefinition<S extends Scope = Scope> {
  type: 'middleware';
  scope: S;
  init: MiddlewareInit<S>;
}

export function defineMiddleware<S extends Scope>(
  scope: S,
  init: NoInfer<MiddlewareInit<S>>,
): MiddlewareDefinition<S> {
  return { type: 'middleware', scope, init };
}

type Chained<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => infer R
    ? (next: () => R) => R
    : T[K];
};

