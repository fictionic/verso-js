import type {ResponderConfig} from "./ResponderConfig";
import type {VersoRequest} from "../VersoRequest";
import type {ParamData} from "path-to-regexp";
import type {RouteMatch} from "../../server/router";

export interface RouteInfo {
  getName(): string;
  getParams(): ParamData;
}

export interface RouteHandlerCtx {
  getConfig: ResponderConfig['getValue'];
  getRoute(): RouteInfo;
  getRequest(): VersoRequest;
}

export function createCtx(config: ResponderConfig, versoRequest: VersoRequest, route: RouteMatch): RouteHandlerCtx {
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
