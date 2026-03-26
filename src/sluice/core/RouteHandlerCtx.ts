import type {ResponderConfig} from "./ResponderConfig";
import type {SluiceRequest} from "./SluiceRequest";

export interface RouteHandlerCtx {
  getConfig: ResponderConfig['getValue'];
  getRequest(): SluiceRequest;
}

export function createCtx(config: ResponderConfig, sluiceRequest: SluiceRequest): RouteHandlerCtx {
  return {
    getConfig: config.getValue,
    getRequest: () => sluiceRequest,
  };
}
