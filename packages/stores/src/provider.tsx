import type {ReactNode} from "react";
import {STORE_DEFINITION_INTERNALS, STORE_INSTANCE_INTERNALS} from "./core/constants";
import {type IsoStoreInstance} from "./core";

interface Props {
  stores: Array<IsoStoreInstance<any>>,
  children: ReactNode;
}
export function IsoStoreProvider({ stores, children }: Props) {
  return stores.reduceRight(
    (acc, instance) => {
      const { definition } = instance[STORE_INSTANCE_INTERNALS];
      const { StoreProvider: Provider } = definition[STORE_DEFINITION_INTERNALS];
      return <Provider instance={instance}>{acc}</Provider>;
    },
    children as ReactNode,
  );
}
