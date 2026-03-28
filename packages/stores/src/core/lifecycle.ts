import {useEffect} from "react";
import {STORE_DEFINITION_INTERNALS, STORE_INSTANCE_INTERNALS} from "./constants";
import {type IsoStoreInstance, type ProviderID} from "./types";

export function useIsoStoreLifecycle(providerId: ProviderID, instance: IsoStoreInstance<unknown> | null) {
  useEffect(() => {
    if (instance === null) return;
    const internals = instance[STORE_INSTANCE_INTERNALS];
    const { onMount, definition } = internals;
    onMount(); // set async client-only state
    const instancesByProvider = definition[STORE_DEFINITION_INTERNALS].instancesByProvider;
    instancesByProvider.set(providerId, instance);
    return () => {
      instancesByProvider.delete(providerId);
    };
  }, [providerId, instance]);
}
