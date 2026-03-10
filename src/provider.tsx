import type {ReactNode} from "react";
import {STORE_DEFINITION_INTERNALS, STORE_INSTANCE_INTERNALS, type IsoStoreInstance} from "./core";

interface Props {
  instances: Array<IsoStoreInstance<any>>,
  children: ReactNode;
}
export function IsoStoreProvider({ instances, children }: Props) {
  return instances.reduceRight(
    (acc, instance) => {
      const { definition } = instance[STORE_INSTANCE_INTERNALS];
      const { StoreProvider: Provider } = definition[STORE_DEFINITION_INTERNALS];
      return <Provider instance={instance}>{acc}</Provider>;
    },
    children as ReactNode,
  );
}
