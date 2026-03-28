import {
  createStore as createNativeZustandStore,
  type StoreApi as NativeZustandStore,
  type StateCreator as NativeZustandStoreInit,
} from "zustand/vanilla";
import { useStore as useNativeZustandStore } from "zustand/react";
import { type Adapter } from '@verso-js/stores/adapter';
import { defineIsoStore, type IsoStoreInit } from '@verso-js/stores';

type UseZustandStore<State> = {
  (): State;
  <U>(selector: (s: State) => U): U;
};
type UseZustandClientStore<State> = {
  (): State | undefined;
  <U>(selector: (s: State) => U): U | undefined;
};

interface ZustandHooks<State> {
  useStore: UseZustandStore<State>;
};

interface ZustandClientHooks<State> {
  useStore: UseZustandClientStore<State>;
};

const emptyZStore = createNativeZustandStore<Record<string, never>>(() => ({}));

export type { NativeZustandStoreInit };

export const getAdapter: <State extends object>() => Adapter<
  State,
  NativeZustandStore<State>,
  NativeZustandStoreInit<State>,
  ZustandHooks<State>,
  ZustandClientHooks<State>
> = <State>() => {

  function callHook(store: NativeZustandStore<State>): State;
  function callHook<U>(store: NativeZustandStore<State>, selector: (s: State) => U): U;
  function callHook<U>(store: NativeZustandStore<State>, selector?: (s: State) => U): State | U {
    return selector ? useNativeZustandStore(store, selector) : useNativeZustandStore(store);
  }

  const getHooks = (getNativeStore: () => NativeZustandStore<State>): ZustandHooks<State> => {
    function hook(): State;
    function hook<U>(selector: (s: State) => U): U;
    function hook(selector?: any) {
      const store = getNativeStore();
      return selector ? callHook(store, selector) : callHook(store);
    }
    return {
      useStore: hook,
    };
  };

  return {
    createNativeStore: (zInit) => {
      const store = createNativeZustandStore(zInit);
      // getInitialState is what's used in the server render.
      // we need it to return the resolved async values from waitFor,
      // since that's what the client will render with.
      // consumers don't need access to the initial state from the constructor.
      store.getInitialState = store.getState;
      return store;
    },
    getSetState: (nativeStore: NativeZustandStore<State>) => (
      (state: Partial<State>) => nativeStore.setState(state)
    ),
    getHooks: getHooks,
    getClientHooks: (getNativeStore: () => NativeZustandStore<State>, ready: boolean): ZustandClientHooks<State> => {
      const hooks = getHooks(getNativeStore);
      function useStore(): State | undefined;
      function useStore<U>(selector: (s: State) => U): U | undefined;
      function useStore(selector?: any) {
        const value = selector ? hooks.useStore(selector) : hooks.useStore();
        return ready ? value : undefined;
      }
      return { useStore };
    },
    empty: emptyZStore as NativeZustandStore<State>,
  };
};

export const defineZustandIsoStore = <Opts, State extends object, Message = never>(
  isoInit: IsoStoreInit<Opts, State, Message, NativeZustandStoreInit<State>>,
  options?: { onError?: (error: unknown) => void },
) => defineIsoStore(isoInit, getAdapter<State>(), options);
