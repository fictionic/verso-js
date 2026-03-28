import http from 'node:http';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { VersoConfig } from '../config';
import { resolveOutDir } from '../config';
import type { BundleManifest, BundleResult } from '../bundle';
import type { SiteConfig } from '../server/router';
import type { RouteHandlerDefinition } from '../core/handler/RouteHandler';
import { createVersoServer } from '../server/createVersoServer';
import { importModule } from '../util/importModule';
import { toWebRequest, sendWebResponse } from '../server/nodeHttp';

async function loadBundleResult(outDir: string, siteConfigPath: string): Promise<BundleResult> {
  const manifestPath = path.resolve(outDir, 'manifest.json');
  const manifest: BundleManifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

  // Read all bundle files from disk
  const bundlesDir = path.resolve(outDir, 'bundles');
  const files = await readdir(bundlesDir);
  const bundleContents: Record<string, string> = {};
  await Promise.all(
    files.map(async (file) => {
      const bundlePath = `bundles/${file}`;
      bundleContents[bundlePath] = await readFile(path.resolve(outDir, bundlePath), 'utf-8');
    })
  );

  // Import handler modules from the site config
  const site = await importModule<SiteConfig>(siteConfigPath);
  const rootDir = path.dirname(siteConfigPath);
  const handlersByRoute: Record<string, RouteHandlerDefinition<any, any, any>> = {};
  await Promise.all(
    Object.entries(site.routes).map(async ([routeName, routeConfig]) => {
      const handler = await importModule<RouteHandlerDefinition<any, any, any>>(path.resolve(rootDir, routeConfig.handler));
      handlersByRoute[routeName] = handler;
    })
  );

  return { manifest, bundleContents, handlersByRoute };
}

export async function runStart(config: VersoConfig) {
  const routesPath = path.resolve(process.cwd(), config.routes);
  const outDir = resolveOutDir(config);

  const bundleResult = await loadBundleResult(outDir, routesPath);

  const port = config.server?.port ?? 3000;
  const urlPrefix = config.server?.urlPrefix ?? `http://localhost:${port}`;

  const versoServer = await createVersoServer({
    siteConfigPath: routesPath,
    bundleResult,
    urlPrefix,
    renderTimeout: config.server?.renderTimeout,
  });

  const server = http.createServer(async (nodeReq, nodeRes) => {
    try {
      const url = new URL(nodeReq.url ?? '/', urlPrefix);
      const request = toWebRequest(nodeReq, url);
      const response = await versoServer.serve(request);
      await sendWebResponse(nodeRes, response);
    } catch (e) {
      console.error('[verso]', e);
      nodeRes.statusCode = 500;
      nodeRes.end();
    }
  });

  server.listen(port, () => {
    console.log(`[verso] Server started at ${urlPrefix}`);
  });
}
