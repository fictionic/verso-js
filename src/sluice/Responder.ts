import type {BaseConfig} from "./core/ResponderConfig";

export interface HandleRouteResult {
  status: number;
};

export type MaybePromise<T> = T | Promise<T>;

export type ResponderType = 'page' | 'endpoint';

export interface BaseChainedMethods {
  handleRoute(): MaybePromise<HandleRouteResult>;
}

export interface BaseHookMethods {
  setConfigValues<ConfigValues>(): Partial<ConfigValues>;
}

export interface ResponderFns {
  getConfig<ConfigValues extends BaseConfig>(key: keyof ConfigValues): ConfigValues[typeof key];
}

export type ResponderInit<Methods> = (fns: ResponderFns) => Methods;

export interface ResponderDefinition<R extends ResponderType, Factory> {
  type: R;
  init: ResponderInit<Factory>;
}
export function defineResponder<R extends ResponderType, Methods>(type: R, init: ResponderInit<Methods>): ResponderDefinition<R, Methods> {
  return {
    type,
    init,
  };
};
