import UserStore from './UserStore';
import PrefsStore from './PrefsStore';
import {StoreRoot} from './StoreRoot';
import UserWidget from './UserWidget';
import NotificationsWidget from './NotificationsWidget';
import Header from './Header';
import RootElement from './RootElement';

// Server-side entry point (e.g. react-server's getElements / handleRoute).
// Each RootElement streams independently — the header and notifications render
// immediately while the UserStore root waits for whenReady.
function getElements() {
  const userStore = UserStore.createStore({ userId: 1 });
  const prefsStore = PrefsStore.createStore({ userId: 1 });
  return [
    // Header is in its own root with no UserStore context.
    // It communicates with UserStore via broadcast().
    <RootElement>
      <Header />
    </RootElement>,

    // Blocks streaming until userStore.whenReady resolves.
    <StoreRoot instances={[userStore]}>
      <UserWidget />
    </StoreRoot>,

    // Multiple stores wired to a single root — blocks until both are ready.
    // Both stores are available anywhere in the tree via their useStore hooks.
    <StoreRoot instances={[userStore, prefsStore]}>
      <UserWidget />
    </StoreRoot>,

    // NotificationsWidget creates its own store on the client — no SSR needed.
    <RootElement>
      <NotificationsWidget />
    </RootElement>,
  ];
}
