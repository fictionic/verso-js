// Test-only entry for the shared adapter conformance suite. Exposed to the
// `store-adapter-*` packages via the `@verso-js/stores/conformance` subpath
// export (see package.json). Not part of the published runtime surface —
// tsup builds only `index` + `adapter`, so this never lands in dist.
export { describeIsoStoreAdapter } from "./suite";
export type {
  ConformanceRecipe,
  ValueSeed,
  ValueStoreHandle,
  CounterStoreHandle,
  MessageStoreHandle,
  RenameMessage,
  DuplicateKeyMode,
} from "./recipe";
