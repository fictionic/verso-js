import {startRequest} from "../common/RequestLocalStorage";
import {ServerCookies} from "./ServerCookies";
import {Fetch} from "../common/fetch/Fetch";
import {handlePage} from "./handlePage";
import {handleEndpoint} from "./handleEndpoint";
import {html404, html500} from "./errorPages";
import type {ServerSettings} from "../../build/config";
import {startRequestClock} from "./clock";
import type {RouteResponder} from "./RouteResponder";
import type {Navigator} from "../common/navigator";

export async function handleRequest(
  req: Request,
  navigator: Navigator,
  settings: ServerSettings,
) {
  const response = await startRequest(async () => {
    startRequestClock();
    const cookies = new ServerCookies(req);
    Fetch.serverInit(req, settings);

    const headers = new Headers();
    function concatHeaders(newHeaders: Headers) {
      newHeaders.forEach((value, name) => {
        headers.append(name, value);
      });
    }

    const { routerTimeout } = settings;
    const failsafe = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("[verso] navigation timeout")), routerTimeout);
    });
    const navigation = await Promise.race([
      navigator.navigate(req),
      failsafe,
    ]);

    switch (navigation.kind) {
      case 'not-found':
        return new Response(html404, {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      case 'error':
        return new Response(html500, {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      case 'directive':
        break;
      default:
        navigation satisfies never;
        throw new Error('unexpected navigation result');
    }

    const { status, location, handler } = navigation;

    const cookieHeaders = cookies.consumeHeaders();
    concatHeaders(cookieHeaders);

    if (location) {
      headers.append('Location', location);
      return new Response(null, {
        status,
        headers,
      });
    }

    let body = null;

    if (handler) {
      const handlerHeaders = handler.getHeaders();
      concatHeaders(handlerHeaders);

      let responder: RouteResponder<any>;
      switch(handler.type) {
        case 'page':
          responder = handlePage;
          break;
        case 'endpoint':
          responder = handleEndpoint;
          break;
        default:
          throw new Error(`invalid route handler type ${handler satisfies never}`);
      }
      const { getContentType, getBody } = responder(handler, settings);
      headers.append('Content-Type', getContentType());
      body = await getBody();
    }
    return new Response(body, {
      status,
      headers,
    });
  });
  return response;
}

export type HandleRequest = typeof handleRequest;
