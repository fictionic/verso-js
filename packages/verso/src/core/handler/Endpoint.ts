import type {MaybePromise} from "../util/types";
import {defineRouteHandler, type RouteHandler, type RouteHandlerDefinition, type RouteHandlerInit, type StandardizedRouteHandler} from "./RouteHandler";

export type EndpointResponseData = string | ArrayBuffer | ReadableStream;

export interface EndpointRequiredMethods {
  getContentType(): string;
  getResponseData(): MaybePromise<EndpointResponseData>;
};

export type Endpoint = RouteHandler<'endpoint', {}, EndpointRequiredMethods>;

export type EndpointInit = RouteHandlerInit<'endpoint', Endpoint>;

export type EndpointDefinition = RouteHandlerDefinition<'endpoint', {}, EndpointRequiredMethods>;

export type StandardizedEndpoint = StandardizedRouteHandler<{}, EndpointRequiredMethods>;

const ENDPOINT_REQUIRED_METHOD_NAMES: (keyof EndpointRequiredMethods)[] = ['getContentType', 'getResponseData'];

export function defineEndpoint(init: EndpointInit): EndpointDefinition {
  return defineRouteHandler('endpoint', init, {}, ENDPOINT_REQUIRED_METHOD_NAMES);
}
