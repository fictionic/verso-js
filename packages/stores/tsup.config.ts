import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    adapter: 'src/adapter.ts',
    // adapter conformance test suite
    conformance: 'src/conformance/index.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@verso-js/verso',
    'vitest',
    '@testing-library/react',
  ],
});
