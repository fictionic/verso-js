import { defineConfig } from 'vite';
import { verso } from '@verso-js/verso/plugin';

export default defineConfig({
  build: {
    minify: false,
  },
  plugins: [
    await verso(),
  ],
});
