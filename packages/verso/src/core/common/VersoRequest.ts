import type {ParamData} from "path-to-regexp";

export class VersoRequest {
  private url: URL;
  private routeParams: ParamData;

  constructor(url: URL, params: ParamData) {
    this.url = url;
    this.routeParams = params;
  }

  getParams() {
    return this.routeParams;
  }

  getURL() {
    // TODO: note somewhere that this is not isomorphic because location.hash isn't sent to the server
    return this.url;
  }

  getPath() {
    return this.url.pathname;
  }

  getQuery() {
    return this.url.searchParams;
  }
}

