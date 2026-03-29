import {match, type ParamData} from "path-to-regexp";
import {ensureArray} from "../util/array";
import type {MiddlewareDefinition} from "../core/handler/Middleware";

export type SiteConfig = {
  middleware?: MiddlewareDefinition[];
  routes: Routes;
};

export type Routes = {
  [routeName: string]: {
    path: string;
    handler: string;
    method?: string | string[];
  };
};

export interface RouteMatch {
  routeName: string;
  params: ParamData;
  handler: string;
  method: string;
};

export function createRouter(routes: Routes) {
  const compiled = Object.entries(routes).map(([routeName, routeConfig]) => {
    const { path, handler, method } = routeConfig;
    const methods = !!method ? ensureArray(method) : ['GET'];
    return {
      routeName,
      matchFn: match(path),
      methods,
      handler,
    };
  });
  return {
    matchRoute: (path: string, method: string): RouteMatch | null => {
      for (const { routeName, matchFn, methods, handler } of compiled) {
        if (!methods.includes(method.toUpperCase())) {
          continue;
        }
        const result = matchFn(path);
        if (result) {
          return {
            routeName,
            params: result.params,
            method,
            handler,
          };
        }
      }
      return null;
    },
  };
}
