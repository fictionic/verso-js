import type {MiddlewareConfig} from "./MiddlewareConfig";
import type {VersoRequest} from "../VersoRequest";
import type {ParamData} from "path-to-regexp";
import type {RouteMatch} from "../router";

export interface RouteInfo {
  getName(): string;
  getParams(): ParamData;
}

export interface RouteHandlerCtx {
  getConfig: MiddlewareConfig['getValue'];
  getRoute(): RouteInfo;
  getRequest(): VersoRequest;
}

export function createCtx(config: MiddlewareConfig, versoRequest: VersoRequest, route: RouteMatch): RouteHandlerCtx {
  const routeInfo = {
    getName: () => route.routeName,
    getParams: () => route.params,
  };
  return {
    getConfig: config.getValue,
    getRequest: () => versoRequest,
    getRoute: () => routeInfo,
  };
}
