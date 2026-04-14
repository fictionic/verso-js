import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { valtio: 'src/valtio.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  external: [
    'react',
    'valtio',
    '@verso-js/stores',
  ],
});
