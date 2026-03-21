import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  define: {
    SERVER_SIDE: JSON.stringify('true'),
  },
  test: {
    exclude: ['node_modules', 'e2e'],
  },
});
