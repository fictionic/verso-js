import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { build as viteBuild, resolveConfig } from 'vite';

export async function runBuild() {
  console.log('[verso] Building...');

  // Resolve the outDir from vite.config.ts (default: 'dist')
  const resolved = await resolveConfig({}, 'build');
  const outDir = path.resolve(resolved.root, resolved.build.outDir);

  // Client build — plugin injects input, output config, and emits manifest.json + verso-meta.json
  const clientResult = await viteBuild({
    logLevel: 'warn',
    build: { write: false, minify: false },
  });

  const clientOutput = Array.isArray(clientResult) ? clientResult[0]! : clientResult;
  if (!('output' in clientOutput)) {
    throw new Error('Vite client build returned unexpected result');
  }
  await writeOutputToDisk(outDir, clientOutput.output);

  // Server build — plugin detects ssr: true and adjusts config accordingly
  const serverResult = await viteBuild({
    logLevel: 'warn',
    build: { write: false, minify: false, ssr: true },
  });

  const serverOutput = Array.isArray(serverResult) ? serverResult[0]! : serverResult;
  if (!('output' in serverOutput)) {
    throw new Error('Vite server build returned unexpected result');
  }
  await writeOutputToDisk(outDir, serverOutput.output);

  console.log(`[verso] Build complete → ${outDir}/`);
}

async function writeOutputToDisk(outDir: string, output: readonly any[]) {
  await Promise.all(output.map(async (item) => {
    const filePath = path.resolve(outDir, item.fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    if (item.type === 'chunk') {
      await writeFile(filePath, item.code);
    } else if (item.type === 'asset') {
      await writeFile(filePath, item.source);
    }
  }));
}
