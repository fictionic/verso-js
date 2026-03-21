import { parse, type Cookies } from 'cookie';
import { getNamespace } from '../util/requestLocal';
import type {ParamData} from 'path-to-regexp';

const RLS = getNamespace<{ current: RequestContext }>();

export class RequestContext {
  readonly routeParams: ParamData;
  private request: Request | null;
  private _cookies: Cookies | null = null;

  static serverInit(req: Request, routeParams: ParamData) {
    return new RequestContext(routeParams, req);
  }

  static clientInit(routeParams: ParamData) {
    return new RequestContext(
      routeParams,
    );
  }

  private constructor(routeParams: ParamData, request?: Request) {
    this.routeParams = routeParams;
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
