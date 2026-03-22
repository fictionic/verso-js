import { startRequest } from '../util/requestLocal';
import { RequestContext } from '../core/RequestContext';
import { Fetch } from '../core/fetch/Fetch';
import {makeStreamer} from './stream';
import {ResponseCookies} from './ResponseCookies';
import type {ParamData} from 'path-to-regexp';
import type {RouteAssets} from '../bundle';
import type {PageInit} from '../Page';
import {ResponderConfig} from '../core/ResponderConfig';

const RENDER_TIMEOUT_MS = 20_000;

interface Options {
  routeAssets: RouteAssets;
  renderTimeout?: number;
  urlPrefix?: string;
};

export async function handlePage(
  req: Request,
  init: PageInit,
  routeParams: ParamData,
  {
    routeAssets,
    renderTimeout = RENDER_TIMEOUT_MS,
    urlPrefix,
  }: Options,
): Promise<Response> {

  const response = await startRequest(async () => {
    RequestContext.serverInit(req, routeParams);
    const cookies = new ResponseCookies();
    Fetch.init({ urlPrefix: urlPrefix ?? null });
    const c = new ResponderConfig();
    const page = init({ getConfig: c.getValue });
    let statusCode: number;
    try {
      const { status } = await page.handleRoute();
      statusCode = status;
    } catch (err) {
      console.error('[sluice] error during handleRoute', err);
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

    const streamer = makeStreamer(page, { renderTimeout, routeAssets } );
    const readable = streamer.stream();
    return new Response(readable, {
      status: statusCode,
      headers,
    });
  });
  return response;
}

