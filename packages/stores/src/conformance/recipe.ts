import type { AnyStoreDef, DefinitionOptions, IsoStoreDefinition } from "../core/types";

/** How the single `value` key of a value store is seeded. */
export type ValueSeed<T> =
  | { kind: "sync"; value: T }
  /** blocking `setAsync("value", promise)` */
  | { kind: "async"; promise: Promise<T> }
  /** `setNonBlockingAsync("value", promise, initial)` */
  | { kind: "nonBlocking"; promise: Promise<T>; initial: T }
  /** keyless `waitFor(gate)`; `value` stays the same */
  | { kind: "waitFor"; value: T; gate: Promise<unknown> };

export type DuplicateKeyMode =
  | "async+async"
  | "nonBlocking+nonBlocking"
  | "async+nonBlocking";

export interface ValueStoreHandle<T> {
  def: AnyStoreDef;
  /** Reads `value` through `def.hooks`. */
  useValue: () => T | undefined;
  /** Reads `value` through a client-hooks bag (from `useCreateClientStore` / singleton `useClientHooks`). */
  readClient: (clientHooks: unknown) => T | undefined;
}

export interface CounterStoreHandle {
  def: AnyStoreDef;
  useCount: () => number;
  useIncrement: () => () => void;
}

export type RenameMessage = { type: "rename"; name: string };

export interface MessageStoreHandle {
  def: IsoStoreDefinition<any, RenameMessage, any, any, any>;
  useName: () => string;
}

export interface ConformanceRecipe {
  name: string;

  makeValueStore: <T>(seed: ValueSeed<T>, options?: DefinitionOptions) => ValueStoreHandle<T>;

  /** One blocking `setAsync` per promise. */
  makeMultiAsyncStore: (promises: Array<Promise<unknown>>) => { def: AnyStoreDef };

  /** Registers the same async key twice. Its `createStore` must throw. */
  makeDuplicateKeyStore: (mode: DuplicateKeyMode) => AnyStoreDef;

  makeCounterStore: () => CounterStoreHandle;

  /** `onMessage` sets `name` on a `rename` message. */
  makeMessageStore: (initial: string) => MessageStoreHandle;
}
