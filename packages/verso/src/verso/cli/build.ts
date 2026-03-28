import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import type { VersoConfig } from '../config';
import { resolveOutDir } from '../config';
import { bundle, bundleServer } from '../viteBundler';
import type { SiteConfig } from '../server/router';
import { importModule } from '../util/importModule';

export async function runBuild(config: VersoConfig) {
  const routesPath = path.resolve(process.cwd(), config.routes);
  const outDir = resolveOutDir(config);

  console.log('[verso] Building...');

  // Client build
  const result = await bundle(routesPath);

  await mkdir(path.resolve(outDir, 'bundles'), { recursive: true });

  await Promise.all(
    Object.entries(result.bundleContents).map(([bundlePath, contents]) =>
      writeFile(path.resolve(outDir, bundlePath), contents)
    )
  );

  await writeFile(
    path.resolve(outDir, 'manifest.json'),
    JSON.stringify(result.manifest, null, 2)
  );

  // Server build
  const site = await importModule<SiteConfig>(routesPath);
  const serverBundleContents = await bundleServer(routesPath, site);

  await mkdir(path.resolve(outDir, 'server'), { recursive: true });
  await mkdir(path.resolve(outDir, 'server', 'chunks'), { recursive: true });
  await Promise.all(
    Object.entries(serverBundleContents).map(([bundlePath, contents]) =>
      writeFile(path.resolve(outDir, bundlePath), contents)
    )
  );

  console.log(`[verso] Build complete → ${outDir}/`);
}
