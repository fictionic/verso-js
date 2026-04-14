import type {ReactNode} from "react";
import {STORE_DEFINITION_INTERNALS, STORE_INSTANCE_INTERNALS} from "./core/constants";
import type {InternalIsoStoreInstance, IsoStoreInstance} from "./core/types";

interface Props {
  stores: Array<IsoStoreInstance<any>>,
  children: ReactNode;
}
export function IsoStoreProvider({ stores, children }: Props) {
  return stores.reduceRight(
    (acc, instance) => {
      const internal = instance as InternalIsoStoreInstance<any>;
      const { definition } = internal[STORE_INSTANCE_INTERNALS];
      const { StoreProvider: Provider } = definition[STORE_DEFINITION_INTERNALS];
      return <Provider instance={instance}>{acc}</Provider>;
    },
    children as ReactNode,
  );
}
