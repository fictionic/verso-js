import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: 'smoke.spec.ts',
  webServer: {
    command: 'verso build && verso start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
