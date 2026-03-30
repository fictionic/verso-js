import {defineIsoStore, type Adapter, type IsoStoreInit} from "@verso-js/stores/adapter";
import {proxy, useSnapshot, type Snapshot} from "valtio";

export interface ValtioHooks<State> {
  useProxy: () => State;
  useSnapshot: () => Snapshot<State>;
};

export interface ValtioClientHooks<State> {
  useProxy: () => State | undefined;
  useSnapshot: () => Snapshot<State> | undefined;
};

const empty = proxy({});

/**
 * Valtio doesn't fit as cleanly into this machinery. Instead of talking directly to the proxy by
 * importing it, components access it via a useProxy hook that the store definition provides, alongside
 * useSnapshot. Maybe a little weird, but basically the same.
 * Note that the first three parameters are the same because the store instance _is_ the store state (it's
 * a proxy), and there is no store constructor--the user just passes the initial state into proxy().
 */
export const getAdapter: <State extends object>() => Adapter<
  State,
  State,
  State,
  ValtioHooks<State>,
  ValtioClientHooks<State>
> = <State extends object>() => {
  return {
    createNativeStore: (initialState: State) => proxy(initialState),
    getSetState: (proxy) => (
      (state) => Object.assign(proxy, state)
    ),
    getHooks: (getNativeStore) => {
      return {
        useProxy: () => getNativeStore(),
        useSnapshot: () => useSnapshot(getNativeStore()),
      };
    },
    getClientHooks: (getNativeStore, ready) => {
      return {
        useProxy: () => {
          const proxy = getNativeStore();
          return ready ? proxy : undefined;
        },
        useSnapshot: () => {
          const snapshot = useSnapshot(getNativeStore());
          return ready ? snapshot : undefined;
        },
      };
    },
    empty: empty as State,
  };
};

export const defineValtioIsoStore = <Opts, State extends object, Message = never>(
  isoInit: IsoStoreInit<Opts, State, Message, State>,
  options?: { onError?: (error: unknown) => void },
) => defineIsoStore(isoInit, getAdapter<State>(), options);
