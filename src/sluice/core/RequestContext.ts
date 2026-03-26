import { parse, type Cookies } from 'cookie';
import { getNamespace } from '../util/requestLocal';

const RLS = getNamespace<{ current: RequestContext }>();

export class RequestContext {
  private request: Request | null;
  private _cookies: Cookies | null = null;

  static serverInit(req: Request) {
    return new RequestContext(req);
  }

  static clientInit() {
    return new RequestContext();
  }

  private constructor(request?: Request) {
    this.request = request ?? null;
    RLS().current = this;
  }

  get cookies(): Cookies {
    if (!this._cookies) {
      if (!this.request) {
        throw new Error("no request object exists clientside");
      }
      this._cookies = parse(this.request!.headers.get('cookie') ?? '');
    }
    return this._cookies;
  }

  static get(): RequestContext | undefined {
    return RLS().current;
  }
}

export function getCurrentRequestContext(): RequestContext {
  return RequestContext.get()!;
}
