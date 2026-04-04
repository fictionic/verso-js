import {defineIsoStore, type Adapter, type IsoStoreInit} from "@verso-js/stores/adapter";
import {proxy as valtioProxy, useSnapshot, type Snapshot} from "valtio";

export interface ValtioHooks<State> {
  useProxy: () => State;
  useSnapshot: () => Snapshot<State>;
};

export interface ValtioClientHooks<State> {
  useProxy: () => State | undefined;
  useSnapshot: () => Snapshot<State> | undefined;
};

export type ValtioInit<State> = State | ((getProxy: () => State) => State);

const empty = valtioProxy({});

/**
 * Valtio doesn't fit as cleanly into this machinery. Instead of talking directly to the proxy by
 * importing it, components access it via a useProxy hook that the store definition provides, alongside
 * useSnapshot. Maybe a little weird, but basically the same.
 * Note that the first two type parameters are the same because the store instance _is_ the store state--it's
 * a proxy. The store constructor is also just the state. But then there would be no way to set up onMessage,
 * as mutations happen directly on the proxy. To address this, the init can also be a function that accepts a
 * getter that lazily provides the proxy after the fact.
 */
export const getAdapter: <State extends object>() => Adapter<
  State,
  State,
  ValtioInit<State>,
  ValtioHooks<State>,
  ValtioClientHooks<State>
> = <State extends object>() => {
  return {
    createNativeStore: (init: ValtioInit<State>) => {
      if (typeof init === 'function') {
        let proxy: State | null = null;
        const getProxy = () => {
          if (!proxy) {
            throw new Error("proxy not yet created!");
          }
          return proxy;
        };
        const initialState = init(getProxy);
        proxy = valtioProxy(initialState);
        return proxy;
      } else {
        return init;
      }
    },
    getSetState: (proxy) => (
      (state) => Object.assign(proxy, state)
    ),
    useHooks: (useNativeStore) => {
      return {
        useProxy: () => useNativeStore(),
        useSnapshot: () => useSnapshot(useNativeStore()),
      };
    },
    useClientHooks: (useNativeStore, ready) => {
      return {
        useProxy: () => {
          const proxy = useNativeStore();
          return ready ? proxy : undefined;
        },
        useSnapshot: () => {
          const snapshot = useSnapshot(useNativeStore());
          return ready ? snapshot : undefined;
        },
      };
    },
    empty: empty as State,
  };
};

export const defineValtioIsoStore = <Opts, State extends object, Message = never>(
  isoInit: IsoStoreInit<Opts, State, Message, ValtioInit<State>>,
  options?: { onError?: (error: unknown) => void },
) => defineIsoStore(isoInit, getAdapter<State>(), options);
