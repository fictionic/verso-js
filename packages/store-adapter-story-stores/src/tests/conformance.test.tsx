// @vitest-environment jsdom

import { describeIsoStoreAdapter } from "@verso-js/stores/conformance";
import type {
  ConformanceRecipe,
  DuplicateKeyMode,
  RenameMessage,
  ValueSeed,
} from "@verso-js/stores/conformance";
import { defineStoryStore } from "../story-stores";

// StoryClientHooks is not exported
type StoryClientHooksShape<State> = {
  useStory: <U>(selector: (s: State) => U) => U | undefined;
};

const storyStoresRecipe: ConformanceRecipe = {
  name: "story-stores",

  makeValueStore<T>(seed: ValueSeed<T>, options?: { onError?: (error: unknown) => void }) {
    type State = { value: T };
    const def = defineStoryStore<object, State>((_, { setAsync, setNonBlockingAsync, waitFor }) => {
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
      useValue: (): T | undefined => def.hooks.useStory((s) => s.value),
      readClient: (clientHooks: unknown): T | undefined =>
        (clientHooks as StoryClientHooksShape<State>).useStory((s) => s.value),
    };
  },

  makeMultiAsyncStore(promises: Array<Promise<unknown>>) {
    type State = Record<string, unknown>;
    const def = defineStoryStore<object, State>((_, { setAsync }) => () => {
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
    return defineStoryStore<object, State>((_, { setAsync, setNonBlockingAsync }) => () => {
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
    const def = defineStoryStore<object, State>(() => ({ update }) => ({
      count: 0,
      increment: () => update((s) => { s.count += 1; }),
    }));
    return {
      def,
      useCount: () => def.hooks.useStory((s) => s.count),
      useIncrement: () => def.hooks.useStory((s) => s.increment),
    };
  },

  makeMessageStore(initial: string) {
    type State = { name: string };
    const def = defineStoryStore<object, State, RenameMessage>((_, { onMessage }) => ({ update }) => {
      onMessage((msg) => {
        if (msg.type === "rename") update((s) => { s.name = msg.name; });
      });
      return { name: initial };
    });
    return {
      def,
      useName: () => def.hooks.useStory((s) => s.name),
    };
  },
};

describeIsoStoreAdapter(storyStoresRecipe);
