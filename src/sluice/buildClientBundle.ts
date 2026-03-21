import { unlink } from 'node:fs/promises';

export async function buildClientBundle(routesModulePath: string): Promise<string> {
  const entryPath = `/tmp/iso-client-entry-${Date.now()}.tsx`;

  await Bun.write(entryPath, `
import routes from "${routesModulePath}";
import { bootstrap } from ${JSON.stringify(import.meta.dir + '/client/bootstrap.ts')};
bootstrap(routes);
`);

  try {
    const result = await Bun.build({
      entrypoints: [entryPath],
      target: 'browser',
      minify: false,
      define: { 'SERVER_SIDE': 'false' },
    });

    if (!result.success) {
      for (const msg of result.logs) console.error(msg);
      throw new Error('Client bundle build failed');
    }

    return await result.outputs[0]!.text();
  } finally {
    await unlink(entryPath).catch(() => {});
  }
}
