import type {ReactNode} from "react";

// export interface AdaptedStore<State, NativeStore, NativeHook> {
//   setState: (state: Partial<State>) => void;
// }

export const STORE_INSTANCE_INTERNALS: unique symbol = Symbol();

export type WaitFor<State> = <K extends keyof State, V extends State[K]>(name: K, promise: Promise<V>, initialValue: V) => { [key in K]: V };
export type MessageHandler<Message> = (message: Message) => void;
export type OnMessage<Message> = (handler: MessageHandler<Message>) => void;

export interface IsoStoreInstance<NativeStore> {
  whenReady: Promise<void>;
  [STORE_INSTANCE_INTERNALS]: {
    identifier: symbol;
    definition: IsoStoreDefinition<any, any, any, any, any>;
    nativeStore: NativeStore;
    messageHandlers: Array<MessageHandler<any>>;
  },
}

export type StoreProvider<NativeStore> = React.FC<{ instance: IsoStoreInstance<NativeStore>, children: ReactNode }>;
export type UseCreateClientStore<Opts, NativeClientHook> = (opts: Opts) => {
  ready: boolean;
  useClientStore: NativeClientHook;
};
export type Broadcast<Message> = (message: Message) => void;

export const STORE_DEFINITION_INTERNALS: unique symbol = Symbol();

export interface IsoStoreDefinition<Opts, Message, NativeStore, NativeHook, NativeClientHook> {
  // use this to create a new instance of a store
  createStore: (opts: Opts) => IsoStoreInstance<NativeStore>
  // use this to select from a wired-up store from a component anywhere underneath
  useStore: NativeHook;
  // use this to create and select from a store after the first client render
  useCreateClientStore: UseCreateClientStore<Opts, NativeClientHook>;
  // use this to send messages to all instances of a store
  broadcast: Broadcast<Message>;
  // don't use this (you can't)
  [STORE_DEFINITION_INTERNALS]: {
    StoreProvider: StoreProvider<NativeStore>;
  };
}

