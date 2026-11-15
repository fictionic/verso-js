import { defineDummyIsoStore, type DummyClientHooks } from "./DummyStoresAdapter";
import type { DefinitionOptions } from "../../core/types";
import type {
  ConformanceRecipe,
  DuplicateKeyMode,
  RenameMessage,
  ValueSeed,
} from "../../conformance/recipe";

export const dummyStoreRecipe: ConformanceRecipe = {
  name: "dummy",

  makeValueStore<T>(seed: ValueSeed<T>, options?: DefinitionOptions) {
    type State = { value: T };
    const def = defineDummyIsoStore<void, State>((_, { setAsync, setNonBlockingAsync, waitFor }) => {
      switch (seed.kind) {
        case "sync":
          return () => ({ value: seed.value });
        case "async":
          return () => ({ ...setAsync("value", seed.promise) });
        case "nonBlocking":
          return () => ({ ...setNonBlockingAsync("value", seed.promise, seed.initial) });
        case "waitFor":
          return () => {
            waitFor(seed.gate);
            return { value: seed.value };
          };
      }
    }, options);
    return {
      def,
      useValue: (): T | undefined => def.hooks.useStore((s) => s.value),
      readClient: (clientHooks: unknown): T | undefined =>
        (clientHooks as DummyClientHooks<State>).useStore((s) => s.value),
    };
  },

  makeMultiAsyncStore(promises: Array<Promise<unknown>>) {
    type State = Record<string, unknown>;
    const def = defineDummyIsoStore<void, State>((_, { setAsync }) => () => {
      const state: State = {};
      promises.forEach((promise, i) => {
        Object.assign(state, setAsync(`k${i}`, promise));
      });
      return state;
    });
    return { def };
  },

  makeDuplicateKeyStore(mode: DuplicateKeyMode) {
    type State = { value: unknown };
    return defineDummyIsoStore<void, State>((_, { setAsync, setNonBlockingAsync }) => () => {
      switch (mode) {
        case "async+async":
          return {
            ...setAsync("value", Promise.resolve("a")),
            ...setAsync("value", Promise.resolve("b")),
          };
        case "nonBlocking+nonBlocking":
          return {
            ...setNonBlockingAsync("value", Promise.resolve("a"), ""),
            ...setNonBlockingAsync("value", Promise.resolve("b"), ""),
          };
        case "async+nonBlocking":
          return {
            ...setAsync("value", Promise.resolve("a")),
            ...setNonBlockingAsync("value", Promise.resolve("b"), ""),
          };
      }
    });
  },

  makeCounterStore() {
    type State = { count: number; increment: () => void };
    const def = defineDummyIsoStore<void, State>(() => (set, get) => ({
      count: 0,
      increment: () => set({ count: get().count + 1 }),
    }));
    return {
      def,
      useCount: () => def.hooks.useStore((s) => s.count),
      useIncrement: () => def.hooks.useStore((s) => s.increment),
    };
  },

  makeMessageStore(initial: string) {
    type State = { name: string };
    const def = defineDummyIsoStore<void, State, RenameMessage>((_, { onMessage }) => (set) => {
      onMessage((msg) => {
        if (msg.type === "rename") set({ name: msg.name });
      });
      return { name: initial };
    });
    return {
      def,
      useName: () => def.hooks.useStore((s) => s.name),
    };
  },
};
