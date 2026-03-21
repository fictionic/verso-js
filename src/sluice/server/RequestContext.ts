import { parse, type Cookies } from 'cookie';
import { getNamespace } from '../util/requestLocal';

const RLS = getNamespace<{ current?: RequestContext }>();

export class RequestContext {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  private _cookies: Cookies | null = null;

  constructor(req: Request) {
    this.url = req.url;
    this.method = req.method;
    this.headers = req.headers;
  }

  get cookies(): Cookies {
    if (!this._cookies) {
      this._cookies = parse(this.headers.get('cookie') ?? '');
    }
    return this._cookies;
  }

  static get(): RequestContext {
    // TODO: what should this class be for on the client?
    return RLS().current!;
  }

  register(): void {
    RLS().current = this;
  }
}
