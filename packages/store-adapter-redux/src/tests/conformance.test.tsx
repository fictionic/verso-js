// @vitest-environment jsdom
//
// The redux row of the spec-30 adapter conformance matrix. Expresses each
// scenario in redux's native idiom — a `(dispatch, getState) => Reducer` store
// init, `dispatch(action)` mutations, and `useSelector`/`useDispatch` reads.
//
// Unlike zustand/valtio, the redux adapter exports no `defineReduxIsoStore`
// convenience, so the recipe wires the definition itself via the core
// `defineIsoStore(isoInit, getAdapter())`.
import { describeIsoStoreAdapter } from "@verso-js/stores/conformance";
import type {
  ConformanceRecipe,
  DuplicateKeyMode,
  RenameMessage,
  ValueSeed,
} from "@verso-js/stores/conformance";
import { defineIsoStore } from "@verso-js/stores";
import type { IsoStoreInit } from "@verso-js/stores";
import { getAdapter, type ReduxStoreInit } from "../redux";

// The redux client-hooks bag the suite hands to `readClient`. `ReduxClientHooks`
// is internal to the adapter, so the structural shape is declared here.
type ReduxClientHooksShape<State> = {
  useSelector: <U>(selector: (s: State) => U) => U | undefined;
};

const INCREMENT = "@@conformance/INCREMENT";
const RENAME = "@@conformance/RENAME";

const reduxRecipe: ConformanceRecipe = {
  name: "redux",

  makeValueStore<T>(seed: ValueSeed<T>, options?: { onError?: (error: unknown) => void }) {
    type State = { value: T };
    const isoInit: IsoStoreInit<object, State, never, ReduxStoreInit<State>> =
      (_, { setAsync, setNonBlockingAsync, waitFor }) =>
      () => {
        let initial: State;
        switch (seed.kind) {
          case "sync":
            initial = { value: seed.value };
            break;
          case "async":
            initial = { ...setAsync("value", seed.promise) };
            break;
          case "nonBlocking":
            initial = { ...setNonBlockingAsync("value", seed.promise, seed.initial) };
            break;
          case "waitFor":
            waitFor(seed.gate);
            initial = { value: seed.value };
            break;
        }
        return (state = initial) => state;
      };
    const def = defineIsoStore(isoInit, getAdapter<State>(), options);

    return {
      def,
      useValue: (): T | undefined => def.hooks.useSelector((s) => s.value),
      readClient: (clientHooks: unknown): T | undefined =>
        (clientHooks as ReduxClientHooksShape<State>).useSelector((s) => s.value),
    };
  },

  makeMultiAsyncStore(promises: Array<Promise<unknown>>) {
    type State = Record<string, unknown>;
    const isoInit: IsoStoreInit<object, State, never, ReduxStoreInit<State>> =
      (_, { setAsync }) =>
      () => {
        const initial: State = {};
        promises.forEach((promise, i) => {
          Object.assign(initial, setAsync(`k${i}`, promise));
        });
        return (state = initial) => state;
      };
    return { def: defineIsoStore(isoInit, getAdapter<State>()) };
  },

  makeDuplicateKeyStore(mode: DuplicateKeyMode) {
    type State = { value: unknown };
    const isoInit: IsoStoreInit<object, State, never, ReduxStoreInit<State>> =
      (_, { setAsync, setNonBlockingAsync }) =>
      () => {
        let initial: State;
        switch (mode) {
          case "async+async":
            initial = {
              ...setAsync("value", Promise.resolve("a")),
              ...setAsync("value", Promise.resolve("b")),
            };
            break;
          case "nonBlocking+nonBlocking":
            initial = {
              ...setNonBlockingAsync("value", Promise.resolve("a"), ""),
              ...setNonBlockingAsync("value", Promise.resolve("b"), ""),
            };
            break;
          case "async+nonBlocking":
            initial = {
              ...setAsync("value", Promise.resolve("a")),
              ...setNonBlockingAsync("value", Promise.resolve("b"), ""),
            };
            break;
        }
        return (state = initial) => state;
      };
    return defineIsoStore(isoInit, getAdapter<State>());
  },

  makeCounterStore() {
    type State = { count: number };
    const isoInit: IsoStoreInit<object, State, never, ReduxStoreInit<State>> =
      () =>
      () =>
      (state = { count: 0 }, action) => {
        if (action.type === INCREMENT) return { count: state.count + 1 };
        return state;
      };
    const def = defineIsoStore(isoInit, getAdapter<State>());
    return {
      def,
      useCount: () => def.hooks.useSelector((s) => s.count),
      useIncrement: () => {
        const dispatch = def.hooks.useDispatch();
        return () => dispatch({ type: INCREMENT });
      },
    };
  },

  makeMessageStore(initial: string) {
    type State = { name: string };
    const isoInit: IsoStoreInit<object, State, RenameMessage, ReduxStoreInit<State>> =
      (_, { onMessage }) =>
      (dispatch) => {
        onMessage((msg) => {
          if (msg.type === "rename") dispatch({ type: RENAME, name: msg.name });
        });
        return (state = { name: initial }, action) => {
          if (action.type === RENAME) return { name: action.name as string };
          return state;
        };
      };
    const def = defineIsoStore(isoInit, getAdapter<State>());
    return {
      def,
      useName: () => def.hooks.useSelector((s) => s.name),
    };
  },
};

describeIsoStoreAdapter(reduxRecipe);
