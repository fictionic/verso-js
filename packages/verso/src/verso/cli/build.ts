import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import type { VersoConfig } from '../config';
import { resolveOutDir } from '../config';
import { bundle } from '../viteBundler';

export async function runBuild(config: VersoConfig) {
  const routesPath = path.resolve(process.cwd(), config.routes);
  const outDir = resolveOutDir(config);

  console.log('[verso] Building...');

  const result = await bundle(routesPath);

  await mkdir(path.resolve(outDir, 'bundles'), { recursive: true });

  // Write bundle files to disk
  await Promise.all(
    Object.entries(result.bundleContents).map(([bundlePath, contents]) =>
      writeFile(path.resolve(outDir, bundlePath), contents)
    )
  );

  // Write manifest
  await writeFile(
    path.resolve(outDir, 'manifest.json'),
    JSON.stringify(result.manifest, null, 2)
  );

  console.log(`[verso] Build complete → ${outDir}/`);
}
