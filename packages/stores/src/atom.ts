import {defineIsoStore, type Adapter, type IsoStoreInit} from "./adapter";

/**
 * A minimal store adapter for the common case of fetching a single async
 * value. Use this when you'd otherwise reach for a full store implementation
 * (Zustand, Redux, etc.) just to hold one resolved promise.
 *
 * `defineAsyncAtom(getPromise)` returns an iso-store definition whose state
 * is `{ value: T }`, populated via `setAsync` when the promise resolves.
 * Roots that gate on `whenReady` will block until the value is available;
 * the `useAtom` hook reads it.
 *
 * The client-side variant returns `undefined` until hydration is complete,
 * matching the lifecycle of any other iso-store.
 *
 * Example:
 *
 * const MyAtom = defineAsyncAtom<number>((id) => fetchUserInfo(id));
 * const a = MyAtom.createStore(getUserIdFromRequest());
 *
 * a.whenReady // blocks until promise resolves
 * MyAtom.hooks.useValue() // returns resolved value
 */

type Atom<T> = { value: T };
type AtomHooks<T> = { useAtom: () => T };
type AtomClientHooks<T> = { useAtom: () => T | undefined };

const getAdapter: <T>() => Adapter<
  Atom<T>,
  Atom<T>,
  Atom<T>,
  AtomHooks<T>,
  AtomClientHooks<T>
> = <T>() => {
  const useHooks = (useNativeStore: () => Atom<T>): AtomHooks<T> => {
    const store = useNativeStore();
    return {
      useAtom: () => store.value,
    };
  };

  return {
    createNativeStore: (state) => state,
    getSetState: (nativeStore: Atom<T>) => (
      (partial: Partial<Atom<T>>) => {
        if ('value' in partial) nativeStore.value = partial.value as T;
      }
    ),
    useHooks,
    useClientHooks: (useNativeStore: () => Atom<T>, ready: boolean): AtomClientHooks<T> => {
      const { useAtom } = useHooks(useNativeStore);
      const value = useAtom();
      return {
        useAtom: () => ready ? value : undefined,
      };
    },
    empty: { value: undefined } as Atom<T>,
  };
};

export const defineAsyncAtom = <T, Opts = void>(getPromise: (opts: Opts) => Promise<T>) => {
  const isoInit: IsoStoreInit<Opts, Atom<T>, void, Atom<T>> = (opts, { setAsync }) => setAsync('value', getPromise(opts));
  return defineIsoStore(isoInit, getAdapter<T>());
};
