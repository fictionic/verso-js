// @vitest-environment jsdom

import { describeIsoStoreAdapter } from "@verso-js/stores/conformance";
import type {
  ConformanceRecipe,
  DuplicateKeyMode,
  RenameMessage,
  ValueSeed,
} from "@verso-js/stores/conformance";
import { defineValtioIsoStore } from "../valtio";

// declared structurally to avoid the variance of valtio's Snapshot<T>
type ValtioClientSnapshotShape<State> = {
  useSnapshot: () => State | undefined;
};

const valtioRecipe: ConformanceRecipe = {
  name: "valtio",

  makeValueStore<T>(seed: ValueSeed<T>, options?: { onError?: (error: unknown) => void }) {
    type State = { value: T };
    const def = defineValtioIsoStore<object, State>((_, { setAsync, setNonBlockingAsync, waitFor }) => {
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
      useValue: (): T | undefined => (def.hooks.useSnapshot() as State).value,
      readClient: (clientHooks: unknown): T | undefined =>
        (clientHooks as ValtioClientSnapshotShape<State>).useSnapshot()?.value,
    };
  },

  makeMultiAsyncStore(promises: Array<Promise<unknown>>) {
    type State = Record<string, unknown>;
    const def = defineValtioIsoStore<object, State>((_, { setAsync }) => () => {
      const initial: State = {};
      promises.forEach((promise, i) => {
        Object.assign(initial, setAsync(`k${i}`, promise));
      });
      return initial;
    });
    return { def };
  },

  makeDuplicateKeyStore(mode: DuplicateKeyMode) {
    type State = { value: unknown };
    return defineValtioIsoStore<object, State>((_, { setAsync, setNonBlockingAsync }) => () => {
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
    const def = defineValtioIsoStore<object, State>(() => (getProxy) => ({
      count: 0,
      increment: () => {
        getProxy().count += 1;
      },
    }));
    return {
      def,
      useCount: () => def.hooks.useSnapshot().count,
      useIncrement: () => def.hooks.useProxy().increment,
    };
  },

  makeMessageStore(initial: string) {
    type State = { name: string };
    const def = defineValtioIsoStore<object, State, RenameMessage>((_, { onMessage }) => (getProxy) => {
      onMessage((msg) => {
        if (msg.type === "rename") getProxy().name = msg.name;
      });
      return { name: initial };
    });
    return {
      def,
      useName: () => def.hooks.useSnapshot().name,
    };
  },
};

describeIsoStoreAdapter(valtioRecipe);
