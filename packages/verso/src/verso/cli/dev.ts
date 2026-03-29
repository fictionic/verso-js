import { createServer } from 'vite';

export async function runDev(port: number) {
  const vite = await createServer({
    server: { port },
  });
  await vite.listen();
  vite.printUrls();
}
