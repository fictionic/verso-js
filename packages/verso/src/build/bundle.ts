export const BUNDLES_DIR = 'bundles';

export type RouteAssets = {
  scripts: string[];
  preloads?: string[];
  inlineScripts?: string[];
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
};
