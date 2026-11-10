import { defineConfig } from '@verso-js/verso/config';

export default defineConfig({
  server: {
    // resolvePublicRequest enforces the host allowlist; requests are rejected
    // without this. Port 3001 keeps the fixture off the demo's E2E port (3000).
    allowedHosts: ['localhost:3001'],
    fetchOrigin: 'loopback',
  },
  routes: {
    Health: { path: '/', handler: './src/endpoints/health' },
    BasicPage: { path: '/basic', handler: './src/pages/basic' },
    MultiRoot: { path: '/multi-root', handler: './src/pages/multi-root' },
    SlowRoot: { path: '/slow-root', handler: './src/pages/slow-root' },
    FetchData: { path: '/fetch-data', handler: './src/pages/fetch-data' },
    ErrorRoot: { path: '/error-root', handler: './src/pages/error-root' },
    NavTarget: { path: '/nav-target', handler: './src/pages/nav-target' },
    Portal: { path: '/portal', handler: './src/pages/portal' },
    DelayEndpoint: { path: '/api/delay', handler: './src/endpoints/delay' },
    DataEndpoint: { path: '/api/data', handler: './src/endpoints/data' },
  },
});
