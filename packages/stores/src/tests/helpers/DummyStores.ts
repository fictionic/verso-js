import { useSyncExternalStore } from "react";

// a dummy store framework that exists purely to be able to test the
// @verso-js/stores infrastructure without depending on an external store
// library

export interface DummyStore<State> {
  getState: () => State;
  setState: (partial: Partial<State>) => void;
  subscribe: (listener: () => void) => () => void;
}

export type DummyStoreCreator<State> = (
  set: (partial: Partial<State>) => void,
  get: () => State,
) => State;

export function createDummyStore<State extends object>(
  creator: DummyStoreCreator<State>,
): DummyStore<State> {
  let state = {} as State;
  const listeners = new Set<() => void>();

  const getState = () => state;
  const setState = (partial: Partial<State>) => {
    state = { ...state, ...partial };
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  // seed initial state, threading set/get to the creator (so actions can close over them).
  state = creator(setState, getState);

  return { getState, setState, subscribe };
}

export function useDummyStore<State, U>(store: DummyStore<State>, selector: (s: State) => U): U {
  const getSnapshot = () => selector(store.getState());
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
