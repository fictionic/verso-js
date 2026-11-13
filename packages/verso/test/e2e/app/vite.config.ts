import { defineConfig } from 'vite';
import { verso } from '@verso-js/verso/plugin';
import { node } from '@verso-js/adapter-node';

export default defineConfig(async () => ({
  // must match webServer.url in the playwright configs
  server: {
    port: 3001,
    strictPort: true,
  },
  plugins: [
    await verso({
      // dev does not use the adapter. The prod smoke build needs it.
      adapter: node(),
    }),
  ],
}));
