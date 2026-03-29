const command = process.argv[2];

switch (command) {
  case 'build': {
    const { runBuild } = await import('./cli/build');
    await runBuild();
    break;
  }
  case 'start': {
    const { runStart } = await import('./cli/start');
    const outDir = process.argv[3];
    await runStart(outDir);
    break;
  }
  case 'dev': {
    const { runDev } = await import('./cli/dev');
    const port = parseInt(process.argv[3] ?? '3000', 10);
    await runDev(port);
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: verso <build|start|dev>');
    process.exit(1);
}
