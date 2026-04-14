import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { zustand: 'src/zustand.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  external: [
    'react',
    'zustand',
    '@verso-js/stores',
  ],
});
