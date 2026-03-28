import path from 'node:path';
import type { VersoConfig } from './config';
import { importModule } from './util/importModule';

const VERSO_CONFIG_FILE = 'verso.config.ts';

async function loadConfig(): Promise<VersoConfig> {
  const configPath = path.resolve(process.cwd(), VERSO_CONFIG_FILE);
  return importModule<VersoConfig>(configPath);
}

const command = process.argv[2];

switch (command) {
  case 'build': {
    const { runBuild } = await import('./cli/build');
    const config = await loadConfig();
    await runBuild(config);
    break;
  }
  case 'start': {
    const { runStart } = await import('./cli/start');
    const config = await loadConfig();
    await runStart(config);
    break;
  }
  case 'dev': {
    const { runDev } = await import('./cli/dev');
    const config = await loadConfig();
    await runDev(config);
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: verso <build|start|dev>');
    process.exit(1);
}
