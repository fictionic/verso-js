import path from 'node:path';
import { build as viteBuild, resolveConfig } from 'vite';

export async function runBuild() {
  console.log('[verso] Building...');

  const resolved = await resolveConfig({}, 'build');
  const outDir = path.resolve(resolved.root, resolved.build.outDir);

  // Client build — plugin writes bundles + manifest to disk
  await viteBuild({
    logLevel: 'warn',
    build: { minify: false },
  });

  // Server build — plugin detects ssr: true and adjusts config accordingly
  await viteBuild({
    logLevel: 'warn',
    build: { minify: false, ssr: true },
  });

  console.log(`[verso] Build complete → ${outDir}/`);
}
