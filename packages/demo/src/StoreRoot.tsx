import React from 'react';
import { makeRootComponent } from '@verso-js/verso';
import { IsoStoreProvider, type IsoStoreInstance } from '@verso-js/stores';

interface Props {
  stores: Array<IsoStoreInstance<any>>;
  children: React.ReactNode;
}

const StoreRoot = makeRootComponent<Props>(
  ({ stores, children }) => (
    <IsoStoreProvider stores={stores}>{children}</IsoStoreProvider>
  ),
  ({ stores }) => ({
    when: Promise.all(stores.map((store) => store.whenReady)).then(() => null),
  }),
);

export default StoreRoot;
