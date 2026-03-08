import MyStore from './MyStore';
import {StoreRoot} from './StoreRoot';
import Widget from './Widget';

function getElements() {
  const instance = MyStore.createStore({ userId: 1 });
  return (
    <StoreRoot StoreProvider={MyStore.StoreProvider} instance={instance}>
      <Widget />
    </StoreRoot>
  );
}
