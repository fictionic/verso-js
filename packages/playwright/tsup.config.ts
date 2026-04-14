import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { fixtures: 'src/fixtures.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['@playwright/test'],
});
