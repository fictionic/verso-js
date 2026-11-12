// @vitest-environment jsdom

import { describeIsoStoreAdapter } from "./conformance";
import { dummyStoreRecipe } from "./helpers/dummyRecipe";

// we can't very well test the isomorphic stores mechanism without an actual
// stores library to use it on. so we have DummyStores, which comes with an
// adapter. then our tests are just the same as the tests for each of the
// other adapters (zustand, etc) -- parameterized by adapter
describeIsoStoreAdapter(dummyStoreRecipe);
