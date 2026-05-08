import type {StandardizedEndpoint} from "../common/handler/Endpoint";
import type {RouteResponse} from "./RouteResponder";

export function handleEndpoint(endpoint: StandardizedEndpoint): RouteResponse {
  return {
    getContentType: () => endpoint.getContentType(),
    getBody: () => endpoint.getResponseData(),
  };
}
