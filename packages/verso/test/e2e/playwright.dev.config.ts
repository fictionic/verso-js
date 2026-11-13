import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  webServer: {
    // Bare `vite`, not `bunx vite`. The outer `bunx playwright test` puts
    // node_modules/.bin on PATH, and the spawn inherits it. A nested `bunx`
    // needs ~/.bun/bin on PATH, which is not guaranteed.
    command: 'vite',
    cwd: fileURLToPath(new URL('./app', import.meta.url)),
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
  },
});
