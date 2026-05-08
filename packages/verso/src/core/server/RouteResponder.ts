import type {ServerSettings} from "../../build/config";
import type {StandardizedRouteHandler} from "../common/handler/RouteHandler";
import type {MaybePromise} from "../common/util/types";

export type RouteResponder<H extends StandardizedRouteHandler<any, any, any>> =
  (handler: H, settings: ServerSettings) => RouteResponse;

export type RouteResponse = {
  getContentType: () => string;
  getBody: () => MaybePromise<BodyInit>;
};
