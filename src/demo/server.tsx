import {createSluiceServer} from '@/sluice/server/createSluiceServer';
import {bundle} from '@/sluice/bunBundler';

const routesPath = import.meta.dir + '/routes';
const bundleResult = await bundle(routesPath);

const sluiceServer = await createSluiceServer({
  routesPath,
  bundleResult,
  urlPrefix: 'http://localhost:3000',
});

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
Bun.serve({
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
    ...sluiceServer.routes,
  },
  fetch: sluiceServer.serve,
});

console.log("started server");
