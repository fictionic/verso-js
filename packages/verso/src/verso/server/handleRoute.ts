import type {RouteHandlerDefinition, RouteHandlerType} from "../core/handler/RouteHandler";
import type {MiddlewareDefinition} from "../core/handler/Middleware";
import {startRequest} from "../util/requestLocal";
import {ServerCookies} from "./ServerCookies";
import {Fetch} from "../core/fetch/Fetch";
import {ResponderConfig} from "../core/handler/ResponderConfig";
import {createHandlerChain} from "../core/handler/chain";
import {handlePage} from "./handlePage";
import {handleEndpoint} from "./handleEndpoint";
import {VersoRequest} from "../core/VersoRequest";
import {createCtx} from "../core/handler/RouteHandlerCtx";
import type {RouteMatch} from "./router";

interface Options {
  urlPrefix?: string;
  renderTimeout?: number;
};

export async function handleRoute<T extends RouteHandlerType>(
  type: T,
  route: RouteMatch,
  routeHandlerDef: RouteHandlerDefinition<T, any, any>,
  globalMiddleware: MiddlewareDefinition[],
  nativeRequest: Request,
  options: Options,
) {
  const response = await startRequest(async () => {
    const req = VersoRequest.serverInit(nativeRequest, route.params);
    const cookies = new ServerCookies(nativeRequest);
    Fetch.serverInit(options.urlPrefix ?? new URL(nativeRequest.url).origin);
    const config = new ResponderConfig();
    const ctx = createCtx(config, req, route);
    const handler = createHandlerChain(type, routeHandlerDef, globalMiddleware, config, ctx);
    let statusCode: number;
    try {
      const directive = await handler.getRouteDirective();
      statusCode = directive.status;
    } catch (err) {
      console.error('[verso] error during getRouteDirective', err);
      return new Response(null, {
        status: 500,
      });
    }
    const headers = new Headers();
    headers.append('Content-Type', 'text/html; charset=utf-8');
    cookies.consumeHeaders().forEach((value, name) => {
      // idk why Headers has ^these args flipped...
      headers.append(name, value);
    });
    let streamable;
    // TODO: respect hasDocument / location from RouteDirective
    switch(type) {
      case 'page':
        streamable = await handlePage(handler, options);
        break;
      case 'endpoint':
        streamable = await handleEndpoint(handler);
        break;
      default:
        throw new Error(`invalid route handler type ${type satisfies never}`);
    }
    return new Response(streamable, {
      status: statusCode,
      headers,
    });
  });
  return response;
}
