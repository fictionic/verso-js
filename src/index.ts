import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode} from "react";
import { createStore as createZustandStore, type StoreApi } from "zustand/vanilla";
import { useStore as useZustandStore } from "zustand";
import {getStoreProvider} from "./StoreProvider";

export type ZustandStore<State> = StoreApi<State>;

type WaitFor<State> = <K extends keyof State, V extends State[K]>(name: K, promise: Promise<V>, initialValue: V) => { [key in K]: V };
export type StoreInit<Opts, State> = (
  opts: Opts,
  set: ZustandStore<State>['setState'],
  get: ZustandStore<State>['getState'],
  waitFor: WaitFor<State>,
) => State;

export interface StoreInstance<State> {
  zStore: ZustandStore<State>;
  ready: Promise<void>;
}

export type UseStore<State> = <T>(selector: (state: State) => T) => T;

export type UseClientStore<State> = <T>(selector: (state: State) => T) => T | null;
export type UseCreateClientStore<Opts, State> = (opts: Opts) => {
  ready: boolean;
  useClientStore: UseClientStore<State>;
};

export type StoreProvider<State> = React.FC<{ instance: StoreInstance<State>, children: ReactNode }>;

export interface StoreDefinition<Opts, State> {
  createStore: (opts: Opts) => StoreInstance<State>
  StoreProvider: StoreProvider<State>;
  useStore: UseStore<State>;
  useCreateClientStore: UseCreateClientStore<Opts, State>;
}

export function defineStore<Opts extends {}, State extends {}>(init: StoreInit<Opts, State>): StoreDefinition<Opts, State> {
  const createStore = (opts: Opts) => {
    const pending: Promise<unknown>[] = [];
    const zStore = createZustandStore<State>((set, get) => {
      const waitFor = <K extends keyof State, V extends State[K]> (name: K, promise: Promise<V>, initialValue: V): { [key in K]: V } => {
        pending.push(promise);
        promise.then((value) => {
          set({ [name]: value } as Partial<State>);
        });
        return { [name]: initialValue } as { [key in K]: V };
      };
      const state = init(opts, set, get, waitFor);
      return state;
    });
    const ready = Promise.all(pending).then(() => {});
    const instance = {
      zStore,
      ready,
    };
    return instance;
  };

  const context = createContext<ZustandStore<State> | null>(null);

  const useStore: UseStore<State> = (selector) => {
    const zStore = useContext(context)
    return useZustandStore(zStore!, selector);
  };

  const useCreateClientStore: UseCreateClientStore<Opts, State> = (opts) => {
    const [ready, setReady] = useState<boolean>(false);
    const instanceRef = useRef<StoreInstance<State> | null>(null);
    useEffect(() => {
      instanceRef.current = createStore(opts);
      instanceRef.current.ready.then(() => {
        setReady(true);
      });
    }, []); // we don't support recreating stores when opts change

    const useClientStore: UseClientStore<State> = (selector) => {
      const emptyStore = useMemo(() => ({
        subscribe: () => (() => {}),
        getState: () => null,
      }), []);
      const getZstoreSnapshot = useCallback(() => {
        return selector(instanceRef.current!.zStore.getState())
      }, [selector]);
      const [subscribe, getSnapshot] = useMemo(() => {
        if (!ready) {
          return [emptyStore.subscribe, emptyStore.getState];
        } else {
          const zStore = instanceRef.current!.zStore;
          return [zStore.subscribe, getZstoreSnapshot];
        }
      }, [ready, getZstoreSnapshot]);
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    };
    return {
      ready,
      useClientStore,
    };
  };

  return {
    createStore,
    StoreProvider: getStoreProvider(context),
    useStore,
    useCreateClientStore,
  };
}

