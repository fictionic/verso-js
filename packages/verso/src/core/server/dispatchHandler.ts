import type {AnyStandardizedHandler} from "../common/handler/RouteHandler";
import {handleEndpoint} from "./handleEndpoint";
import {handlePage} from "./handlePage";
import {exhaustive} from "../../util/invariant";

export type HandlerResponse = {
  contentType: string;
  body: BodyInit;
};

export function dispatchHandler(handler: AnyStandardizedHandler): HandlerResponse {
  switch(handler.type) {
    case 'page':
      return handlePage(handler);
    case 'endpoint':
      return handleEndpoint(handler);
    default:
      exhaustive(handler);
  }
}
