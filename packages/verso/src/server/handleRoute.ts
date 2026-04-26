import type {RouteDirective, RouteHandlerDefinition, RouteHandlerType} from "../core/handler/RouteHandler";
import type {MiddlewareDefinition} from "../core/handler/Middleware";
import {startRequest} from "../core/RequestLocalStorage";
import {ServerCookies} from "./ServerCookies";
import {Fetch} from "../core/fetch/Fetch";
import {ResponderConfig} from "../core/handler/ResponderConfig";
import {createHandlerChain} from "../core/handler/chain";
import {handlePage} from "./handlePage";
import {handleEndpoint} from "./handleEndpoint";
import {VersoRequest} from "../core/VersoRequest";
import {createCtx} from "../core/handler/RouteHandlerCtx";
import type {RouteMatch} from "../core/router";
import {html500} from "./errorPages";
import type {ServerSettings} from "../build/config";

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

export async function handleRoute<T extends RouteHandlerType>(
  type: T,
  route: RouteMatch,
  routeHandlerDef: RouteHandlerDefinition<T, any, any>,
  globalMiddleware: MiddlewareDefinition[],
  nativeRequest: Request,
  settings: ServerSettings,
) {
  const response = await startRequest(async () => {
    const req = VersoRequest.serverInit(nativeRequest, route.params);
    const cookies = new ServerCookies(nativeRequest);
    Fetch.serverInit(nativeRequest, settings);
    const config = new ResponderConfig();
    const ctx = createCtx(config, req, route);
    const handler = createHandlerChain(type, routeHandlerDef, globalMiddleware, config, ctx);

    const headers = new Headers();
    function concatHeaders(newHeaders: Headers) {
      newHeaders.forEach((value, name) => {
        headers.append(name, value);
      });
    }

    let directive: RouteDirective;
    try {
      directive = await handler.getRouteDirective();
    } catch (err) {
      console.error('[verso] error during getRouteDirective', err);
      return new Response(html500, {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const handlerHeaders = handler.getHeaders();
    const cookieHeaders = cookies.consumeHeaders();
    concatHeaders(handlerHeaders);
    concatHeaders(cookieHeaders);

    const statusCode = directive.status;
    const is2XX = ((statusCode / 100)|0) === 2;
    if (!is2XX) {
      if (REDIRECT_STATUSES.includes(statusCode)) {
        const location: string = directive.location ?? '';
        if (!location) {
          console.warn("[verso] empty location header!");
        }
        headers.append('Location', location);
      }
      if (type === 'page' && !directive.hasDocument) {
        // applications can stream a regular SSR page on a non-2XX if they so choose,
        // but they have to opt into it with hasDocument. only applies to Pages
        return new Response(null, {
          status: statusCode,
          headers,
        });
      }
    }

    let streamable;
    switch(type) {
      case 'page':
        headers.append('Content-Type', 'text/html; charset=utf-8');
        streamable = await handlePage(handler, settings);
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

export type HandleRoute = typeof handleRoute;
