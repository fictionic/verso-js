import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  grep: /@smoke/,
  webServer: {
    // bare `vite`: see the dev config. The built entry defaults to port 3000.
    command: 'vite build && node dist/index.js',
    cwd: fileURLToPath(new URL('./app', import.meta.url)),
    url: 'http://localhost:3001',
    env: { PORT: '3001' },
    reuseExistingServer: !process.env.CI,
  },
});
