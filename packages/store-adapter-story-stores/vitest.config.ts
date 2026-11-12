import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The conformance suite is imported from `@verso-js/stores/conformance`, which
// maps to stores *source*. But the adapter under test imports the stores core
// through `@verso-js/stores` / `@verso-js/stores/adapter`, which resolve to
// stores *dist* by default. `core/constants.ts` uses unique `Symbol()`s, so a
// dist-vs-source split would give the provider/singleton/instance internals two
// different symbol identities and break every provider read. Alias the stores
// entrypoints to source so the whole run uses one instance of the core.
const storesSrc = fileURLToPath(new URL('../stores/src', import.meta.url));

export default defineConfig({
  define: {
    IS_SERVER: 'false',
  },
  resolve: {
    alias: [
      { find: /^@verso-js\/stores\/adapter$/, replacement: `${storesSrc}/adapter.ts` },
      { find: /^@verso-js\/stores\/conformance$/, replacement: `${storesSrc}/tests/conformance/index.ts` },
      { find: /^@verso-js\/stores$/, replacement: `${storesSrc}/index.ts` },
    ],
  },
});
