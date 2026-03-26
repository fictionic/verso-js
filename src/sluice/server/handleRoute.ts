import type {ParamData} from "path-to-regexp";
import type {RouteHandlerDefinition, RouteHandlerType} from "../RouteHandler";
import type {MiddlewareDefinition} from "../Middleware";
import type {RouteAssets} from "../bundle";
import {startRequest} from "../util/requestLocal";
import {RequestContext} from "../core/RequestContext";
import {ResponseCookies} from "./ResponseCookies";
import {Fetch} from "../core/fetch/Fetch";
import {ResponderConfig} from "../core/ResponderConfig";
import {createHandlerChain} from "../core/chain";
import {handlePage} from "./handlePage";
import {handleEndpoint} from "./handleEndpoint";

interface Options {
  routeAssets: RouteAssets;
  urlPrefix?: string;
  renderTimeout?: number;
};

export async function handleRoute<T extends RouteHandlerType>(
  type: T,
  req: Request,
  def: RouteHandlerDefinition<T, any, any>,
  routeParams: ParamData,
  globalMiddleware: MiddlewareDefinition[],
  options: Options,
) {
  const response = await startRequest(async () => {
    RequestContext.serverInit(req, routeParams);
    const cookies = new ResponseCookies();
    Fetch.init({ urlPrefix: options.urlPrefix ?? null });
    const config = new ResponderConfig();
    const fns = { getConfig: config.getValue };
    const handler = createHandlerChain(type, def, globalMiddleware, config, fns);
    let statusCode: number;
    try {
      const directive = await handler.getRouteDirective();
      statusCode = directive.status;
    } catch (err) {
      console.error('[sluice] error during getRouteDirective', err);
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
