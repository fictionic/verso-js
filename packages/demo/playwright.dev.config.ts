import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  webServer: {
    command: 'vite',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
