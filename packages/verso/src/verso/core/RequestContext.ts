import { getNamespace } from '../util/requestLocal';

const RLS = getNamespace<{ current: RequestContext }>();

// TODO: what should this be for?
export class RequestContext {
  static serverInit() {
    return new RequestContext();
  }

  static clientInit() {
    return new RequestContext();
  }

  private constructor() {
    RLS().current = this;
  }

  static get(): RequestContext | undefined {
    return RLS().current;
  }
}

export function getCurrentRequestContext(): RequestContext {
  return RequestContext.get()!;
}
