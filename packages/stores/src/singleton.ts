import {getRLS} from "@verso-js/verso";
import {useEffect, useState} from "react";
import type {AllFunctions, CreateStoreArgs, InternalIsoStoreDefinition, IsoStoreDefinition, IsoStoreInstance, SendMessage} from "./core/types";
import {STORE_DEFINITION_INTERNALS} from "./core/constants";

const RLS = getRLS<{ instances: Map<IsoStoreDefinition<any, any, any, any, any>, IsoStoreInstance<any>> }>();

function getInstances(): Map<IsoStoreDefinition<any, any, any, any, any>, IsoStoreInstance<any>> {
  const ns = RLS();
  if (!ns.instances) ns.instances = new Map();
  return ns.instances;
}

export type UseClientHooks<NativeClientHooks> = () => readonly [ready: boolean, clientHooks: NativeClientHooks];

export interface SingletonIsoStoreDefinition<Opts, Message, NativeStore, NativeHooks extends AllFunctions<NativeHooks>, NativeClientHooks extends AllFunctions<NativeClientHooks>> {
  createStore: (...args: CreateStoreArgs<Opts>) => IsoStoreInstance<NativeStore>;
  hooks: NativeHooks;
  useClientHooks: UseClientHooks<NativeClientHooks>;
  message: SendMessage<Message>;
};

export function asSingleton<Opts, Message, NativeStore, NativeHooks extends AllFunctions<NativeHooks>, NativeClientHooks extends AllFunctions<NativeClientHooks>>(
  def: IsoStoreDefinition<Opts, Message, NativeStore, NativeHooks, NativeClientHooks>
): SingletonIsoStoreDefinition<Opts, Message, NativeStore, NativeHooks, NativeClientHooks> {
  return {
    createStore: (...args: CreateStoreArgs<Opts>) => {
      const instances = getInstances();
      if (instances.has(def)) {
        throw new Error("cannot create more than one instance of a singleton store!");
      }
      const instance = def.createStore(...args);
      instances.set(def, instance);
      return instance;
    },
    /**
     * accesses the singleton through context, like normal. will throw if instance not provided.
     */
    hooks: def.hooks,
    /**
     * allows cross-root access to the singleton. has to be resilient against the store
     * not being ready at call time, since an arbitrary root won't be blocked by its resolution.
     * this is clientside only, because if you need server-side access to the store, your root
     * needs to be gated on its resolution, so you might as well just Provide it, and then you
     * should just be using the regular .hooks bag.
     */
    useClientHooks: () => {
      const [ready, setReady] = useState(false);
      const instance = getInstances().get(def) ?? null;
      if (!instance) {
        throw new Error("no singleton instance has been created");
      }
      useEffect(() => {
        instance.whenReady.then(() => {
          setReady(true);
        });
      }, []);
      const adapter = (def as InternalIsoStoreDefinition<Opts, Message, NativeStore, NativeHooks, NativeClientHooks>)[STORE_DEFINITION_INTERNALS].adapter;
      const useNativeStore = () => ready ? instance.nativeStore : adapter.empty;
      const clientHooks = adapter.useClientHooks(useNativeStore, ready);
      return [ready, clientHooks];
    },
    message: def.broadcast,
  };
}
