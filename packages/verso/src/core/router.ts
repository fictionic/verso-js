import {match, type ParamData} from "path-to-regexp";
import {ensureArray} from "../util/array";
import type {RoutesMap} from "../build/config";

export interface RouteMatch {
  routeName: string;
  params: ParamData;
  handler: string;
  method: string;
};

export interface Router {
  matchRoute: (path: string, method: string) => RouteMatch | null;
};

export function createRouter(routes: RoutesMap): Router {
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
    matchRoute: (path, method) => {
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
