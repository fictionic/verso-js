import path from 'node:path';
import type { VersoConfig } from '../config';
import { createDevServer } from '../dev/createDevServer';

export async function runDev(config: VersoConfig) {
  const siteConfigPath = path.resolve(process.cwd(), config.routes);

  await createDevServer({
    siteConfigPath,
    urlPrefix: config.server?.urlPrefix,
  });
}
