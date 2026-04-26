import http from 'node:http';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { BundleManifest } from '../bundle';
import { BUNDLES_DIR } from '../bundle';
import { toURL, toWebRequest, sendWebResponse } from '../nodeHttp';

export async function runStart(outDir = 'dist') {
  // Read client manifest
  const manifestPath = path.resolve(outDir, BUNDLES_DIR, 'manifest.js');
  const manifest: BundleManifest = (await import(manifestPath)).default;

  // Read client bundle files from disk
  const bundlesDir = path.resolve(outDir, BUNDLES_DIR);
  const files = await readdir(bundlesDir);
  const bundleContents: Record<string, string> = {};
  await Promise.all(
    files.map(async (file) => {
      const bundlePath = `${BUNDLES_DIR}/${file}`;
      bundleContents[bundlePath] = await readFile(path.resolve(outDir, bundlePath), 'utf-8');
    })
  );

  // Load pre-built server entry (self-contained: framework + handlers + site config)
  const serverEntryPath = pathToFileURL(path.resolve(outDir, 'server', 'entry.js')).href;
  const { getServer, getSettings } = await import(serverEntryPath);
  const versoServer = await getServer({
    manifest,
    bundleContents,
  });

  const { port } = getSettings();

  const server = http.createServer(async (nodeReq, nodeRes) => {
    try {
      const url = toURL(nodeReq, port);
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
    console.log(`[verso] Server started on port ${port}`);
  });
}
