import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {getStoreProvider} from "./StoreProvider";
import {
  STORE_DEFINITION_INTERNALS,
  STORE_INSTANCE_INTERNALS,
} from "./constants";
import {
  type Adapter,
  type Broadcast,
  type DefinitionID,
  type InstanceID,
  type IsoStoreDefinition,
  type IsoStoreInit,
  type IsoStoreInstance,
  type MessageHandler,
  type OnMessage,
  type ProviderID,
  type UseClientHooks,
  type SetAsyncState,
} from "./types";
import {useIsoStoreLifecycle} from "./lifecycle";

type NativeStoreOf<A> = A extends Adapter<any, infer N, any, any, any> ? N : never;
type HooksOf<A> = A extends Adapter<any, any, any, infer H, any> ? H : never;
type ClientHooksOf<A> = A extends Adapter<any, any, any, any, infer C> ? C : never;

function makeAsyncStateSetter<State>(
  pending: Array<{name: keyof State, promise: Promise<unknown>}>,
  keys: Set<keyof State>,
): SetAsyncState<State> {
  // defined via function because otherwise I'd have to write the types on the next line twice
  return <K extends keyof State, V extends State[K]>(name: K, promise: Promise<V>, initialValue: V) => {
    if (keys.has(name)) {
      throw new Error(`isomorphic-stores: encountered duplicate async key '${String(name)}'; aborting`);
    }
    keys.add(name);
    pending.push({ name, promise });
    return { [name]: initialValue } as { [key in K]: V };
  };
}

// currently, stores should not be defined dynamically, as this will lead to memory leaks
const definitions: Map<DefinitionID, IsoStoreDefinition<any, any, any, any, any>> = new Map();

export function defineIsoStore<Opts, State extends object, Message, NativeStoreInit, A extends Adapter<State, any, NativeStoreInit, any, any>>(
  isoInit: IsoStoreInit<Opts, State, Message, NativeStoreInit>,
  adapter: A,
  options?: { onError?: (error: unknown) => void },
): IsoStoreDefinition<Opts, Message, NativeStoreOf<A>, HooksOf<A>, ClientHooksOf<A>> {
  type NativeStore = NativeStoreOf<A>;
  const definitionId = Symbol() as DefinitionID;

  const instancesByProvider: Map<ProviderID, IsoStoreInstance<NativeStore>> = new Map();

  const createStore = (opts: Opts): IsoStoreInstance<NativeStore> => {
    type PendingValue = { name: keyof State, promise: Promise<unknown> };
    const asyncKeys: Set<keyof State> = new Set();
    const pending: Array<PendingValue> = [];
    const waitFor = makeAsyncStateSetter<State>(pending, asyncKeys);

    const clientPending: Array<PendingValue> = [];
    const clientOnly = makeAsyncStateSetter<State>(clientPending, asyncKeys);

    const messageHandlers: Array<MessageHandler<Message>> = [];
    const onMessage: OnMessage<Message> = (handler) => {
      messageHandlers.push(handler);
    };

    const nativeStoreInit = isoInit(opts, { waitFor, onMessage, clientOnly });
    const nativeStore = adapter.createNativeStore(nativeStoreInit);

    const resolvePending = (items: Array<PendingValue>) =>
      Promise.all(items.map(async ({ name, promise }) => {
        try {
          const value = await promise;
          const setState = adapter.getSetState(nativeStore);
          setState({ [name]: value } as Partial<State>);
        } catch(e) {
          options?.onError?.(new Error(`isomorphic-stores: waitFor promise rejected; refusing to set key '${String(name)}'`, { cause: e }));
        }
      })).then(() => {});

    const whenReady = resolvePending(pending);

    const didMountDfd = Promise.withResolvers<void>();
    didMountDfd.promise.then(() => resolvePending(clientPending));

    return {
      whenReady,
      nativeStore,
      [STORE_INSTANCE_INTERNALS]: {
        identifier: Symbol() as InstanceID,
        definition: definitions.get(definitionId)!,
        messageHandlers,
        onMount: didMountDfd.resolve,
      },
    };
  };

  type IsoContext = IsoStoreInstance<NativeStore> | null;
  const context = createContext<IsoContext>(null);

  const hooks: HooksOf<A> = adapter.getHooks(() => {
    const instance = useContext<IsoContext>(context);
    if (!instance) {
      throw new Error("isomorphic-stores: cannot call hooks outside a provider");
    }
    return instance.nativeStore;
  });

  const useClientHooks: UseClientHooks<Opts, ClientHooksOf<A>> = (opts) => {
    const [ready, setReady] = useState<boolean>(false);
    const instanceRef = useRef<IsoStoreInstance<NativeStore> | null>(null);

    const providerId = useMemo(() => Symbol() as ProviderID, []);

    useEffect(() => {
      const instance = createStore(opts); // ideally we'd support rerendering based on changes to opts
      instance.whenReady.then(() => {
        setReady(true);
      });
      instanceRef.current = instance;
      return () => {
        instanceRef.current = null;
      };
    }, [providerId]);

    useIsoStoreLifecycle(providerId, instanceRef.current);

    const clientHooks = useMemo(() => {
      const getNativeStore = () => {
        return ready ? instanceRef.current!.nativeStore : adapter.empty;
      };
      return adapter.getClientHooks(getNativeStore, ready);
    }, [ready]);

    return [ready, clientHooks];

  };

  const broadcast: Broadcast<Message> = (message: Message) => {
    const seen = new Set<InstanceID>();
    for (const instance of instancesByProvider.values()) {
      const instanceId = instance[STORE_INSTANCE_INTERNALS].identifier;
      if (seen.has(instanceId)) return;
      seen.add(instanceId);
      instance[STORE_INSTANCE_INTERNALS].messageHandlers.forEach(h => h(message));
    }
  };

  const definition = {
    createStore,
    hooks,
    useClientHooks,
    broadcast,
    [STORE_DEFINITION_INTERNALS]: {
      instancesByProvider,
      StoreProvider: getStoreProvider(context),
    },
  };

  definitions.set(definitionId, definition);

  return definition;

}
