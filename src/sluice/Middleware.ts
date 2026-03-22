import type {BaseChainedMethods, BaseHookMethods, ResponderFns, ResponderType} from "./Responder";
import type {EndpointChainedMethods} from "./Endpoint";
import type {PageChainedMethods} from "./Page";
import type {BaseConfig} from "./core/ResponderConfig";

type ChainedResponseMethods = {
  page: PageChainedMethods;
  endpoint: EndpointChainedMethods;
};

type ChainedResponseMethodsFor<R> =
  R extends ResponderType ? ChainedResponseMethods[R] : {};

export type BaseMiddleware<R, ConfigValues = BaseConfig> = &
  Partial<
    { addConfigValues(): ConfigValues } &
    MakeChainedMethods<BaseChainedMethods & ChainedResponseMethodsFor<R>> &
    BaseHookMethods
  >;

type Scope = ResponderType | 'all';

type MiddlewareInit<R, C extends BaseConfig> = (fns: ResponderFns) => BaseMiddleware<R, C>;

interface MiddlewareDefinition<R, C extends BaseConfig> {
  type: 'middleware';
  scope: Scope;
  init: MiddlewareInit<R, C>;
};

type ResolveScope<S extends Scope> = S extends 'all' ? ResponderType : S;

export function defineMiddleware<
  S extends Scope,
  C extends BaseConfig,
>(scope: S, init: MiddlewareInit<ResolveScope<S>, C>): MiddlewareDefinition<ResolveScope<S>, C> {
  return {
    type: 'middleware',
    scope,
    init,
  };
}

export type NextFn<T extends keyof AllChainedMethods> = AllChainedMethods[T];

// helpers

type UnionToIntersection<U> =
  (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

type AllChainedMethods = BaseChainedMethods & UnionToIntersection<ChainedResponseMethods[keyof ChainedResponseMethods]>;

type MakeChainedFunc<F> = F extends () => infer R
  ? (next: () => R) => R
  : never;

type MakeChainedMethods<T> = {
  [K in keyof T]?: T[K] extends () => any ? MakeChainedFunc<T[K]> : never;
};

