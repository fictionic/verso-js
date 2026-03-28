import {useMemo, type Context, type ReactNode} from "react";
import {type IsoStoreInstance, type ProviderID, type StoreProvider} from "./types";
import {useIsoStoreLifecycle} from "./lifecycle";

export function getStoreProvider<NativeStore>(
  context: Context<IsoStoreInstance<NativeStore> | null>,
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
    useIsoStoreLifecycle(identifier, instance);
    return (
      <Provider value={instance}>
        {children}
      </Provider>
    );
  }
}
