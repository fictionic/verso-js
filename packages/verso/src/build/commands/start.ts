import http from 'node:http';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { BundleManifest } from '../bundle';
import { BUNDLES_DIR, MANIFEST_PATH, SERVER_ENTRY_PATH } from '../constants';
import { toURL, toWebRequest, sendWebResponse } from '../nodeHttp';
import type {ServerEntry} from '../entrypoint';

export async function runStart(outDir = 'dist') {
  // Read client manifest
  const manifestPath = path.resolve(outDir, MANIFEST_PATH);
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
  const serverEntryPath = pathToFileURL(path.resolve(outDir, SERVER_ENTRY_PATH)).href;
  const { getServer } = await import(serverEntryPath) as ServerEntry;
  const versoServer = await getServer({
    manifest,
    bundleContents,
  });

  const server = http.createServer(async (nodeReq, nodeRes) => {
    try {
      const url = toURL(nodeReq);
      const request = toWebRequest(nodeReq, nodeRes, url);
      const response = await versoServer.serve(request);
      await sendWebResponse(nodeRes, response);
    } catch (e) {
      console.error('[verso]', e);
      nodeRes.statusCode = 500;
      nodeRes.end();
    }
  });

  // TODO: make this configurable when building out the cli with the adapter system
  const DEFAULT_PORT = 3000;

  server.listen(DEFAULT_PORT, () => {
    console.log(`[verso] Server started on port ${DEFAULT_PORT}`);
  });
}
