import { defineConfig } from 'vite';
import { verso } from '@verso-js/verso/plugin';
import { node } from '@verso-js/adapter-node';

export default defineConfig(async () => ({
  // Pin the dev port so Playwright's `webServer.url` (localhost:3001) is reachable
  // and off the demo's E2E port (3000). strictPort fails loudly instead of
  // silently hopping to the next free port.
  server: {
    port: 3001,
    strictPort: true,
  },
  plugins: [
    await verso({
      // The node adapter is unused under bare `vite` (dev), but the prod build
      // (`vite build`) needs it to emit the runnable `dist/index.js` server entry.
      adapter: node(),
    }),
  ],
}));
