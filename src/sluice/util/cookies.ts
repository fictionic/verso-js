import { parse, stringifySetCookie } from 'cookie';
import { RequestContext } from '../core/RequestContext';
import { ResponseCookies, type CookieOptions } from '../server/ResponseCookies';

declare const SERVER_SIDE: boolean;

export function getCookie(name: string): string | undefined {
  if (SERVER_SIDE) {
    // if we've already set this cookie ourselves, it will override
    // any preexisting value in the browser. we have to use it for our render.
    const fromResponse = ResponseCookies.get()!.getCookie(name);
    if (fromResponse) return fromResponse;
    // if the client sent us a value for the cookie, use that.
    // if the cookie value gets updated after this, there could be trouble!
    const fromRequest = RequestContext.get()!.cookies[name];
    if (fromRequest) return fromRequest;
    // otherwise we have nothing to return
    return undefined;
  }
  return parse(document.cookie)[name];
}

export function setCookie(name: string, value: string, options?: CookieOptions): void {
  if (SERVER_SIDE) {
    // only works before headers have been sent; i.e., before rendering starts.
    // otherwise it will throw.
    ResponseCookies.get()!.setCookie(name, value, options);
  } else {
    document.cookie = stringifySetCookie(name, value, options);
  }
}
