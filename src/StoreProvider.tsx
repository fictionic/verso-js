import type {Context, ReactNode} from "react";
import type {StoreInstance, StoreProvider, ZustandStore} from ".";

export function getStoreProvider<State>(context: Context<ZustandStore<State> | null>): StoreProvider<State> {

  const {Provider} = context;

  interface Props {
    instance: StoreInstance<State>;
    children: ReactNode;
  }
  return function StoreProvider({
    instance,
    children,
  }: Props) {
    return (
      <Provider value={instance.zStore}>
        {children}
      </Provider>
    );
  }
}
