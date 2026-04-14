import {useMemo, type Context, type ReactNode} from "react";
import {type InternalIsoStoreInstance, type IsoStoreInstance, type ProviderID, type StoreProvider} from "./types";
import {useIsoStoreLifecycle} from "./lifecycle";

export function getStoreProvider<NativeStore>(
  context: Context<InternalIsoStoreInstance<NativeStore> | null>,
): StoreProvider<NativeStore> {

  const {Provider} = context;

  interface Props {
    instance: IsoStoreInstance<NativeStore>;
    children: ReactNode;
  }
  return function StoreProvider({
    instance,
    children,
  }: Props) {
    const identifier = useMemo<ProviderID>(() => Symbol() as ProviderID, []);
    const internal = instance as InternalIsoStoreInstance<NativeStore>;
    useIsoStoreLifecycle(identifier, internal);
    return (
      <Provider value={internal}>
        {children}
      </Provider>
    );
  }
}
