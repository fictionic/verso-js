import { parseCookie, parseSetCookie, stringifyCookie, stringifySetCookie, type Cookies, type SetCookie } from 'cookie';
import { getRLS } from '../common/RequestLocalStorage';
import {getServerStash} from './stash';

export type CookieOptions = Omit<SetCookie, 'name' | 'value'>;

const RLS = getRLS<{ current: ServerCookies }>();

export type ResponseCookie = {
  kind: 'value';
  value: string;
} | {
  kind: 'deletion';
} | {
  kind: 'none';
};

export class ServerCookies {
  private requestCookies: Cookies;
  private responseCookies: Map<string, { value: string; options?: CookieOptions }>;

  constructor(req: Request) {
    this.requestCookies = parseCookie(req.headers.get('cookie') ?? '');
    this.responseCookies = new Map();
    RLS().current = this;
  }

  getRequestCookie(name: string): string | undefined {
    return this.requestCookies[name] ?? undefined;
  }

  getRequestCookieHeader(): string {
    return stringifyCookie(this.requestCookies);
  }

  setResponseCookie(name: string, value: string, options?: CookieOptions) {
    throwIfHeadersLocked();
    this.responseCookies.set(name, { value, options });
  }

  setResponseSetCookieHeaders(headers: string[]) {
    throwIfHeadersLocked();
    headers.forEach((header) => {
      const { name, value, ...options } = parseSetCookie(header);
      this.setResponseCookie(name, value ?? '', options);
    });
  }

  getResponseCookie(name: string): ResponseCookie {
    const cookie = this.responseCookies.get(name);
    if (!cookie) return { kind: 'none' };
    if (cookie.options && isResponseCookieDeleted(cookie.options)) return { kind: 'deletion' };
    return { kind: 'value', value: cookie.value };
  }

  getResponseSetCookieHeaders(): Headers {
    const headers = new Headers();
    this.responseCookies.forEach(({ value, options }, name) => {
      headers.append('Set-Cookie', stringifySetCookie({ name, value, ...options }));
    });
    return headers;
  }

  static get(): ServerCookies | undefined {
    return RLS().current;
  }
}

function throwIfHeadersLocked() {
  if (getServerStash().headersLocked) {
    throw new Error("cannot set cookies after HTTP headers have been sent");
  }
}

// the browser deletes a cookie when Max-Age <= 0, or when there is no
// Max-Age and Expires is in the past (RFC 6265 5.3)
function isResponseCookieDeleted(options: CookieOptions): boolean {
  if (options?.maxAge !== undefined) return options.maxAge <= 0;
  if (options?.expires !== undefined) return options.expires.getTime() <= Date.now();
  return false;
}
