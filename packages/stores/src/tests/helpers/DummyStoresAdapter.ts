import { defineIsoStore } from "../../core/define";
import { type Adapter, type IsoStoreInit } from "../../core/types";
import {
  createDummyStore,
  useDummyStore,
  type DummyStore,
  type DummyStoreCreator,
} from "./DummyStores";


export interface DummyHooks<State> {
  useStore: <U>(selector: (s: State) => U) => U;
}

export interface DummyClientHooks<State> {
  useStore: <U>(selector: (s: State) => U) => U | undefined;
}

export function getAdapter<State extends object>(): Adapter<
  State,
  DummyStore<State>,
  DummyStoreCreator<State>,
  DummyHooks<State>,
  DummyClientHooks<State>
> {
  const empty = createDummyStore<State>(() => ({}) as State);

  return {
    createNativeStore: (init) => createDummyStore(init),
    getSetState: (store) => store.setState,
    useHooks: (useNativeStore) => ({
      useStore: (selector) => useDummyStore(useNativeStore(), selector),
    }),
    useClientHooks: (useNativeStore, ready) => ({
      // pre-hydration reads come from the empty store and surface as undefined.
      useStore: (selector) => {
        const value = useDummyStore(ready ? useNativeStore() : empty, selector);
        return ready ? value : undefined;
      },
    }),
    empty,
  };
}

export const defineDummyIsoStore = <Opts, State extends object, Message = never>(
  isoInit: IsoStoreInit<Opts, State, Message, DummyStoreCreator<State>>,
  options?: { onError?: (error: unknown) => void },
) => defineIsoStore(isoInit, getAdapter<State>(), options);
