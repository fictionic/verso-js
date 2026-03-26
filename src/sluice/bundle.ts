import type {RouteHandlerDefinition, RouteHandlerType} from "./RouteHandler";

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
    [routeName: string]: RouteHandlerDefinition<RouteHandlerType, any, any>;
  };
};
