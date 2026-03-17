import { renderPage } from '@/sluice/server/renderPage';
import { buildClientBundle } from '@/sluice/buildClientBundle';
import DemoPage from './DemoPage';

// 1. Build client bundle at startup
const clientJs = await buildClientBundle(import.meta.dir + '/DemoPage.tsx');
console.log(`[build] client bundle: ${(clientJs.length / 1024).toFixed(1)} KB`);

// API data
const NAMES: Record<number, string> = {
  1: 'Alice',
  2: 'Bob',
  3: 'Charlie',
  4: 'Dana',
  5: 'Eve',
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function cookieLatency(req: Request, key: string, fallback: number): number {
  const match = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)latency_${key}=([^;]*)`));
  return match ? Number(match[1]) || fallback : fallback;
}

// 2. Start server
const server = Bun.serve({
  routes: {
    '/api/users/:id': {
      GET: async (req) => {
        const id = Number((req.params as any).id);
        await delay(cookieLatency(req, 'users', 500));
        return Response.json({ username: NAMES[id] ?? `User${id}`, email: `user${id}@example.com` });
      },
    },
    '/api/theme/:userId': {
      GET: async (req) => {
        const userId = Number((req.params as any).userId);
        await delay(cookieLatency(req, 'theme', 400));
        return Response.json({
          theme: userId % 2 === 0 ? 'light' : 'dark',
          accent: '#6366f1',
        });
      },
    },
    '/api/activity': {
      GET: async (req) => {
        await delay(cookieLatency(req, 'activity', 1500));
        return Response.json({
          items: [
            'Edited profile settings',
            'Uploaded a photo',
            'Sent a message to Bob',
            'Updated notification preferences',
            'Joined #general channel',
          ],
        });
      },
    },
    '/client.js': {
      GET: () => new Response(clientJs, { headers: { 'Content-Type': 'application/javascript' } }),
    },
  },
  fetch: handleSSR,
});

const baseUrl = server.url.href.replace(/\/$/, '');
console.log(`isomorphic-stores demo running at ${server.url}`);

// 3. SSR handler
async function handleSSR(req: Request): Promise<Response> {
  return new Response(renderPage(req, DemoPage, {
    clientBundleUrl: '/client.js',
    urlPrefix: baseUrl,
  }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
