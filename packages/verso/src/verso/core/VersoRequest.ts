import type {ParamData} from "path-to-regexp";

export class VersoRequest {
  private url: URL;
  private routeParams: ParamData;

  static serverInit(req: Request, params: ParamData) {
    const url = new URL(req.url);
    return new VersoRequest(url, params);
  }

  static clientInit(params: ParamData) {
    const url = new URL(window.location.href);
    return new VersoRequest(url, params);
  }

  private constructor(url: URL, params: ParamData) {
    this.url = url;
    this.routeParams = params;
  }

  getParams() {
    return this.routeParams;
  }

  getURL() {
    return this.url;
  }

  getPath() {
    return this.url.pathname;
  }

  getQuery() {
    return this.url.searchParams;
  }
}

