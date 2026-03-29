import { defineConfig } from 'vite';
import verso from '@verso-js/verso/plugin';

export default defineConfig({
  plugins: [
    verso({
      routes: './src/routes.ts',
      server: {
        urlPrefix: 'http://localhost:3000',
      },
    }),
  ],
});
