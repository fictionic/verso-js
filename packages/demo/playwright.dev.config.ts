import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  webServer: {
    command: 'verso dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
