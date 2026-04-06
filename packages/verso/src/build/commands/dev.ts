import { createServer } from 'vite';

// TODO:
// this is basically a passthrough to vite for now, but it will need
// to exist as its own thing later for lazy mode
export async function runDev(port: number) {
  const vite = await createServer({
    server: { port },
  });
  await vite.listen();
  vite.printUrls();
}
