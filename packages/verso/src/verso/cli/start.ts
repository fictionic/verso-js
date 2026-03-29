import http from 'node:http';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { BundleManifest } from '../bundle';
import { toWebRequest, sendWebResponse } from '../server/nodeHttp';

export async function runStart(outDir = 'dist') {
  // Read build metadata (written by the plugin during `verso build`)
  const metaPath = path.resolve(outDir, 'verso-meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
  const port = meta.server?.port ?? 3000;
  const urlPrefix = meta.server?.urlPrefix ?? `http://localhost:${port}`;
  const renderTimeout = meta.server?.renderTimeout;

  // Read client manifest
  const manifestPath = path.resolve(outDir, 'manifest.json');
  const manifest: BundleManifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

  // Read client bundle files from disk
  const bundlesDir = path.resolve(outDir, 'bundles');
  const files = await readdir(bundlesDir);
  const bundleContents: Record<string, string> = {};
  await Promise.all(
    files.map(async (file) => {
      const bundlePath = `bundles/${file}`;
      bundleContents[bundlePath] = await readFile(path.resolve(outDir, bundlePath), 'utf-8');
    })
  );

  // Load pre-built server entry (self-contained: framework + handlers + site config)
  const serverEntryPath = pathToFileURL(path.resolve(outDir, 'server', 'entry.js')).href;
  const { createServer } = await import(serverEntryPath);
  const versoServer = await createServer({
    manifest,
    bundleContents,
    urlPrefix,
    renderTimeout,
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
