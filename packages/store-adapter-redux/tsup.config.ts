import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { redux: 'src/redux.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  external: [
    'react',
    'redux',
    '@verso-js/stores',
  ],
});
