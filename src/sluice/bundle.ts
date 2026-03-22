import type {RouteHandler} from "./Handler";

export type RouteAssets = {
  scripts: string[];
  stylesheets: string[];
};

export type BundleManifest = {
  [routeName: string]: RouteAssets;
};

export type BundleResult = {
  manifest: BundleManifest;
  bundleContents: {
    [bundlePath: string]: string;
  };
  handlersByRoute: {
    [routeName: string]: RouteHandler;
  };
};
