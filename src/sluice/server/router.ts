import {match, type ParamData} from "path-to-regexp";
import type {Page} from "../Page";

export type SluiceRoutes = {
  [routeName: string]: {
    path: string;
    page: new () => Page;
  };
};

export interface RouteMatch {
  page: new () => Page;
  params: ParamData;
};

export function createRouter(routes: SluiceRoutes) {
  const compiled = Object.values(routes).map(({ path, page }) => ({
    matchFn: match(path),
    page,
  }));
  return {
    matchRoute: (path: string): RouteMatch | null => {
      for (const { matchFn, page } of compiled) {
        const result = matchFn(path);
        if (result) {
          return {
            page,
            params: result.params,
          };
        }
      }
      return null;
    },
  };
}
