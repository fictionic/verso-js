import { parse, stringifySetCookie } from 'cookie';
import { ServerCookies, type CookieOptions } from '../server/ServerCookies';
import { isServer } from './env';

export function getCookie(name: string): string | undefined {
  if (isServer()) {
    // if we've already set this cookie ourselves, it will override
    // any preexisting value in the browser. we have to use it for our render.
    const fromResponse = ServerCookies.get()!.getResponseCookie(name);
    if (fromResponse) return fromResponse;
    // if the client sent us a value for the cookie, use that.
    // if the cookie value gets updated after this, there could be trouble!
    const fromRequest = ServerCookies.get()!.getRequestCookie(name);
    if (fromRequest) return fromRequest;
    // otherwise we have nothing to return
    return undefined;
  }
  // clientside, there's only one store of cookies
  return parse(document.cookie)[name];
}

export function setCookie(name: string, value: string, options?: CookieOptions): void {
  if (isServer()) {
    // only works before headers have been sent; i.e., before rendering starts.
    // otherwise it will throw.
    ServerCookies.get()!.setResponseCookie(name, value, options);
  } else {
    document.cookie = stringifySetCookie(name, value, options);
  }
}
