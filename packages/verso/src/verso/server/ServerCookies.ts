import { parse, stringifySetCookie, type Cookies, type SetCookie } from 'cookie';
import { getNamespace } from '../util/requestLocal';

export type CookieOptions = Omit<SetCookie, 'name' | 'value'>;

const RLS = getNamespace<{ current: ServerCookies }>();

export class ServerCookies {
  private requestCookies: Cookies;
  private responseCookies: Map<string, { value: string; options?: CookieOptions }>;
  private headersLocked: boolean;

  constructor(req: Request) {
    this.requestCookies = parse(req.headers.get('cookie') ?? '');
    this.responseCookies = new Map();
    this.headersLocked = false;
    RLS().current = this;
  }

  getRequestCookie(name: string): string | undefined {
    return this.requestCookies[name] ?? undefined;
  }

  setResponseCookie(name: string, value: string, options?: CookieOptions) {
    if (this.headersLocked) {
      throw new Error("cannot set cookies after HTTP headers have been sent");
    }
    this.responseCookies.set(name, { value, options });
  }

  getResponseCookie(name: string): string | undefined {
    return this.responseCookies.get(name)?.value;
  }

  consumeHeaders(): Headers {
    this.headersLocked = true;
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
