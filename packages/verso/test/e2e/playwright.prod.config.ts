import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Prod config: runs ONLY the @smoke-tagged subset against the built adapter entry.
// `vite build` emits the runnable `dist/index.js` (node adapter); there is no
// `verso start`. The built entry defaults to port 3000, so PORT=3001 pins it to
// the same port the dev config uses.
export default defineConfig({
  ...base,
  grep: /@smoke/,
  webServer: {
    // Bare `vite` (not `bunx vite`): the outer `bunx playwright test` puts this
    // package's node_modules/.bin (which has `vite`) on the PATH that Playwright's
    // webServer spawn inherits — see the dev config for the full rationale. `node`
    // runs the built adapter entry (there is no `verso start`); `vite build` emits
    // dist/index.js. cwd is `app` so both the build and the entry resolve there.
    command: 'vite build && node dist/index.js',
    cwd: fileURLToPath(new URL('./app', import.meta.url)),
    url: 'http://localhost:3001',
    env: { PORT: '3001' },
    reuseExistingServer: !process.env.CI,
  },
});
