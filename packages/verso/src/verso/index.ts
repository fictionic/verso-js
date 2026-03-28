// Handler definition APIs
export { definePage, type Page, type PageInit, type PageDefinition, type Stylesheet, type LinkTag } from './core/handler/Page';
export { defineMiddleware, type Middleware, type MiddlewareDefinition, type Scope } from './core/handler/Middleware';
export { defineEndpoint, type Endpoint, type EndpointInit, type EndpointDefinition, type EndpointResponseData } from './core/handler/Endpoint';
export type { RouteHandlerCtx } from './core/handler/RouteHandlerCtx';
export type { RouteDirective } from './core/handler/RouteHandler';

// Environment
export { isServer } from './env';

// Components
export { Root, makeRootComponent, type RootAPI, type RootElementType } from './core/components/Root';
export { default as RootContainer } from './core/components/RootContainer';
export { default as TheFold } from './core/components/TheFold';
