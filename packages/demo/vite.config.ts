import { defineConfig } from 'vite';
import verso from '@verso-js/verso/plugin';

export default defineConfig({
  plugins: [
    await verso(),
  ],
});
