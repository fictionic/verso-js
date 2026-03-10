import {useEffect, type Context, type ReactNode} from "react";
import {type IsoStoreInstance, type StoreProvider} from "./types";

export function getStoreProvider<NativeStore>(
  context: Context<IsoStoreInstance<NativeStore> | null>,
  register: ((instance: IsoStoreInstance<NativeStore>) => void),
  teardown: ((instance: IsoStoreInstance<NativeStore>) => void)
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
    useEffect(() => {
      register(instance);
      return () => {
        teardown(instance);
      };
    }, [instance]); // not sure why instance would ever change, but maybe
    return (
      <Provider value={instance}>
        {children}
      </Provider>
    );
  }
}
