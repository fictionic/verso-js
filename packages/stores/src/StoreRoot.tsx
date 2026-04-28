import React from 'react';
import {makeRootComponent} from '@verso-js/verso';
import type {IsoStoreInstance} from './core/types';
import {IsoStoreProvider} from './IsoStoreProvider';

interface Props {
  stores: Array<IsoStoreInstance<any>>;
  children: React.ReactNode;
}
function StoreRoot({ stores, children }: Props) {
  return (
    <IsoStoreProvider stores={stores}>{children}</IsoStoreProvider>
  );
}

export default makeRootComponent<Props>(
  StoreRoot,
  ({ stores }) => ({
    when: Promise.all(stores.map((store) => store.whenReady)).then(() => {}),
    // ^make useRootData return void. children should use the hooks from the stores.
  }),
);
