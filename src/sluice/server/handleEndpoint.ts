import { startRequest } from '../util/requestLocal';
import { RequestContext } from '../core/RequestContext';
import { ResponseCookies } from './ResponseCookies';
import type {ParamData} from 'path-to-regexp';
import {Fetch} from '../core/fetch/Fetch';
import type {EndpointInit} from '../Endpoint';
import {ResponderConfig} from '../core/ResponderConfig';

interface Options {
  urlPrefix?: string;
};

export async function handleEndpoint(
  req: Request,
  init: EndpointInit,
  routeParams: ParamData,
  { urlPrefix }: Options,
): Promise<Response> {
  const response = await startRequest(async () => {
    RequestContext.serverInit(req, routeParams);
    const cookies = new ResponseCookies();
    Fetch.init({ urlPrefix: urlPrefix ?? null });
    const c = new ResponderConfig();
    const endpoint = init({ getConfig: c.getValue });
    let statusCode: number;
    try {
      const { status } = await endpoint.handleRoute();
      statusCode = status;
    } catch (err) {
      console.error('[sluice] error during handleRoute', err);
      return new Response(null, {
        status: 500,
      });
    }
    const headers = cookies.consumeHeaders();
    headers.set('Content-Type', endpoint.getContentType());

    const body = await endpoint.getResponseData();

    return new Response(body, {
      status: statusCode,
      headers,
    });
  });
  return response;
}


