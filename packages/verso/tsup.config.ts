import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { plugin: 'src/verso/plugin.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  external: [
    'vite',
    '@vitejs/plugin-react',
    'react',
    'react-dom',
    'path-to-regexp',
    'cookie',
    'jiti',
  ],
});
