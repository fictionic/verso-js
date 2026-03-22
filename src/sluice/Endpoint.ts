import {defineResponder, type BaseChainedMethods, type BaseHookMethods, type MaybePromise, type ResponderFns} from "./Responder";

export interface EndpointChainedMethods {
  getContentType(): string;
  getResponseData(): MaybePromise<string | ArrayBuffer | ReadableStream>;
}

export interface EndpointMethods extends Partial<BaseHookMethods>, BaseChainedMethods, EndpointChainedMethods {};

export type EndpointInit = (opts: ResponderFns) => EndpointMethods;

export interface EndpointDefinition {
  type: 'endpoint';
  init: EndpointInit;
};

export function defineEndpoint(init: EndpointInit): EndpointDefinition {
  return defineResponder('endpoint', init);
};
