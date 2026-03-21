import {match, type ParamData} from "path-to-regexp";

export type SluiceRoutes = {
  [routeName: string]: {
    path: string;
    page: string;
  };
};

export interface RouteMatch {
  routeName: string;
  page: string;
  params: ParamData;
};

export function createRouter(routes: SluiceRoutes) {
  const compiled = Object.entries(routes).map(([routeName, { path, page }]) => ({
    routeName,
    matchFn: match(path),
    page,
  }));
  return {
    matchRoute: (path: string): RouteMatch | null => {
      for (const { routeName, matchFn, page } of compiled) {
        const result = matchFn(path);
        if (result) {
          return {
            routeName,
            page,
            params: result.params,
          };
        }
      }
      return null;
    },
  };
}
