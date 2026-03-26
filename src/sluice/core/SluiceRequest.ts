import type {ParamData} from "path-to-regexp";

export class SluiceRequest {
  private url: URL;
  private routeParams: ParamData;

  static server(req: Request, params: ParamData) {
    const url = new URL(req.url);
    return new SluiceRequest(url, params);
  }

  static client(params: ParamData) {
    const url = new URL(window.location.href);
    return new SluiceRequest(url, params);
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

