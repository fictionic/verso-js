const command = process.argv[2];

switch (command) {
  case 'start': {
    const { runStart } = await import('./commands/start');
    const outDir = process.argv[3];
    await runStart(outDir);
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: verso start [outDir]');
    process.exit(1);
}
