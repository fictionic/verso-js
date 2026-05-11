import {getAdapter} from './start/adapter-node';

const command = process.argv[2];

switch (command) {
  case 'start': {
    const { runStart } = await import('./start/verso-start');
    const outDir = process.argv[3];
    const adapter = getAdapter(outDir);
    await runStart(adapter);
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: verso start [outDir]');
    process.exit(1);
}
