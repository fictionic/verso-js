import type { ReactNode } from "react";

import { STORE_INSTANCE_INTERNALS, STORE_DEFINITION_INTERNALS } from "./constants";

export type DefinitionID = symbol & { _definitionId: true };
export type ProviderID   = symbol & { _providerId: true };
export type InstanceID   = symbol & { _instanceId: true };

// ---------------------------------------------------------------------------
// Public store API
// ---------------------------------------------------------------------------

export type MessageHandler<Message> = (message: Message) => void;

export interface IsoStoreInstance<NativeStore> {
  whenReady: Promise<void>;
  nativeStore: NativeStore;
  [STORE_INSTANCE_INTERNALS]: {
    identifier: InstanceID;
    definition: IsoStoreDefinition<any, any, any, any, any>;
    messageHandlers: Array<MessageHandler<any>>;
    onMount: () => void;
  };
}

export type StoreProvider<NativeStore> = React.FC<{
  instance: IsoStoreInstance<NativeStore>;
  children: ReactNode;
}>;

export type UseClientHooks<Opts, NativeClientHooks> = (opts: Opts) => readonly [ready: boolean, clientHooks: NativeClientHooks];

export type Broadcast<Message> = (message: Message) => void;

export interface IsoStoreDefinition<Opts, Message, NativeStore, NativeHooks, NativeClientHooks> {
  createStore: (opts: Opts) => IsoStoreInstance<NativeStore>;
  hooks: NativeHooks;
  useClientHooks: UseClientHooks<Opts, NativeClientHooks>;
  broadcast: Broadcast<Message>;
  [STORE_DEFINITION_INTERNALS]: {
    instancesByProvider: Map<ProviderID, IsoStoreInstance<NativeStore>>;
    StoreProvider: StoreProvider<NativeStore>;
  };
}

// ---------------------------------------------------------------------------
// Adapter author API
// ---------------------------------------------------------------------------

export type SetAsyncState<State> = <K extends keyof State, V extends State[K]>(
  name: K,
  promise: Promise<V>,
  initialValue: V,
) => { [_ in K]: V };

export type OnMessage<Message> = (handler: MessageHandler<Message>) => void;

// Functions passed to the outer factory when defining a store.
export interface IsoInitFns<State, Message> {
  waitFor: SetAsyncState<State>;
  clientOnly: SetAsyncState<State>;
  onMessage: OnMessage<Message>;
}

// The outer layer of the two-layer factory pattern: receives opts and fns,
// returns the framework's native inner creator (e.g. Zustand's StateCreator).
export type IsoStoreInit<Opts, State, Message, NativeStoreInit> =
  (opts: Opts, fns: IsoInitFns<State, Message>) => NativeStoreInit;

type AllFunctions<T> = { [K in keyof T]: (...args: any[]) => any };

export interface Adapter<State, NativeStore, NativeStoreInit, NativeHooks extends AllFunctions<NativeHooks>, NativeClientHooks extends AllFunctions<NativeClientHooks>> {
  createNativeStore: (nativeStoreInit: NativeStoreInit) => NativeStore;
  getSetState: (nativeStore: NativeStore) => (state: Partial<State>) => void;
  getHooks: (getNativeStore: () => NativeStore) => NativeHooks;
  getClientHooks: (getNativeStore: () => NativeStore, ready: boolean) => NativeClientHooks;
  empty: NativeStore;
}
