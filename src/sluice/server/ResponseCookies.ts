import { stringifySetCookie, type SetCookie } from 'cookie';
import { getNamespace } from '../util/requestLocal';

export type CookieOptions = Omit<SetCookie, 'name' | 'value'>;

const RLS = getNamespace<{ current: ResponseCookies }>();

export class ResponseCookies {
  private cookies: Map<string, { value: string; options?: CookieOptions }>;
  private locked: boolean;

  constructor() {
    this.cookies = new Map();
    this.locked = false;
  }

  setCookie(name: string, value: string, options?: CookieOptions) {
    if (this.locked) {
      throw new Error("cannot set cookies after HTTP headers have been sent");
    }
    this.cookies.set(name, { value, options });
  }

  getCookie(name: string): string | undefined {
    return this.cookies.get(name)?.value;
  }

  consumeHeaders(): Headers {
    this.locked = true;
    const headers = new Headers();
    this.cookies.forEach(({ value, options }, name) => {
      headers.append('Set-Cookie', stringifySetCookie({ name, value, ...options }));
    });
    return headers;
  }

  static get(): ResponseCookies {
    return RLS().current!;
  }

  register(): void {
    RLS().current = this;
  }
}
