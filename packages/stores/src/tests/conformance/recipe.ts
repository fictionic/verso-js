import type { AnyStoreDef, DefinitionOptions, IsoStoreDefinition } from "../../core/types";

// ---------------------------------------------------------------------------
// The adapter conformance "recipe".
//
// A recipe abstracts *what differs per adapter* — how you express a store with
// a given behavior in that adapter's native idiom (creator+set/get for
// testStore/zustand, reducer+dispatch for redux, a mutated proxy for valtio),
// and how that adapter's hooks read state. The shared suite (`runAdapter
// conformance`) owns everything that is *the same* across adapters: provider
// wiring, `whenReady`/promise timing, `broadcast`, the singleton, RLS, and the
// actual assertions.
//
// This is the contract surface each `store-adapter-*` package implements once
// (phase 5b). Read spec 30 for the matrix these scenarios map onto.
// ---------------------------------------------------------------------------

/**
 * How the single `value` key of a value store is seeded. The recipe maps each
 * variant onto the equivalent native store in its idiom; the suite drives the
 * promises so it controls resolution timing.
 */
export type ValueSeed<T> =
  /** static initial state — `value` is present synchronously. */
  | { kind: "sync"; value: T }
  /** blocking `setAsync("value", promise)` — `value` is `undefined` until resolve. */
  | { kind: "async"; promise: Promise<T> }
  /** `setNonBlockingAsync("value", promise, initial)` — shows `initial`, does not gate `whenReady`. */
  | { kind: "nonBlocking"; promise: Promise<T>; initial: T }
  /** keyless `waitFor(gate)` that blocks `whenReady` while `value` stays `initial`. */
  | { kind: "waitFor"; value: T; gate: Promise<unknown> };

/** The three ways to register a duplicate async key (all must throw). */
export type DuplicateKeyMode =
  | "async+async"
  | "nonBlocking+nonBlocking"
  | "async+nonBlocking";

/** A value store plus the idiom-specific readers the suite renders. */
export interface ValueStoreHandle<T> {
  def: AnyStoreDef;
  /** Read `value` through the provider-context hooks (`def.hooks`). Throws outside a provider. */
  useValue: () => T | undefined;
  /** Read `value` through a client-hooks bag (from `useCreateClientStore` / singleton `useClientHooks`). */
  readClient: (clientHooks: unknown) => T | undefined;
}

/** A counter store with an increment action, for the reactivity scenario. */
export interface CounterStoreHandle {
  def: AnyStoreDef;
  useCount: () => number;
  /** Returns a callback that increments the counter (dispatch / set / proxy-mutate under the hood). */
  useIncrement: () => () => void;
}

/** The broadcast message every message store understands. */
export type RenameMessage = { type: "rename"; name: string };

/** A store whose `onMessage` handler applies a `rename`, for cross-root messaging. */
export interface MessageStoreHandle {
  def: IsoStoreDefinition<any, RenameMessage, any, any, any>;
  useName: () => string;
}

export interface ConformanceRecipe {
  /** Adapter display name — used to label the `describe` blocks. */
  name: string;

  /** A store exposing a single `value`, seeded per {@link ValueSeed}. */
  makeValueStore: <T>(seed: ValueSeed<T>, options?: DefinitionOptions) => ValueStoreHandle<T>;

  /** A store with one blocking `setAsync` per promise, for multi-key `whenReady` gating. */
  makeMultiAsyncStore: (promises: Array<Promise<unknown>>) => { def: AnyStoreDef };

  /** A store that registers the same async key twice (per {@link DuplicateKeyMode}); its `createStore` must throw. */
  makeDuplicateKeyStore: (mode: DuplicateKeyMode) => AnyStoreDef;

  /** A counter store + increment action. */
  makeCounterStore: () => CounterStoreHandle;

  /** A store whose `onMessage` sets `name` on a `rename` message. */
  makeMessageStore: (initial: string) => MessageStoreHandle;
}
