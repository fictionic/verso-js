import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Dev config: runs the FULL suite against the fixture app served by bare `vite`
// (there is no `verso` CLI — the dev server is plain Vite with `await verso()`
// wired into the app's vite.config.ts).
export default defineConfig({
  ...base,
  webServer: {
    // Bare `vite` (not `bunx vite`): Playwright's webServer spawn inherits
    // process.env verbatim — it does NOT inject any node_modules/.bin. The outer
    // `bunx playwright test` (run from this package) is what puts this package's
    // node_modules/.bin (which has `vite`) on PATH, and the spawn inherits it.
    // This mirrors the demo's config and SvelteKit's `pnpm dev` model, where the
    // package-manager runner supplies node_modules/.bin. A nested `bunx` instead
    // needs `~/.bun/bin` on PATH, which the outer runner never guarantees.
    // cwd is `app` so vite loads app/vite.config.ts; PATH is inherited
    // independently of cwd.
    command: 'vite',
    cwd: fileURLToPath(new URL('./app', import.meta.url)),
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
  },
});
