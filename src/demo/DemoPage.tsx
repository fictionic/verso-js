import { ProfileStore, ThemeStore, ActivityStore } from './stores';
import StoreRoot from './StoreRoot';
import RootContainer from '@/sluice/core/components/RootContainer';
import TheFold from '@/sluice/core/components/TheFold';
import { definePage } from '@/sluice/Page';
import { User } from './components/User';
import { Prefs } from './components/Prefs';
import { Activity } from './components/Activity';
import { Broadcast } from './components/Broadcast';
import { LatencyControls } from './components/LatencyControls';

export default definePage(() => {
  // TODO: export these store instance types
  let profile1!: ReturnType<typeof ProfileStore.createStore>;
  let theme1!: ReturnType<typeof ThemeStore.createStore>;
  let activity!: ReturnType<typeof ActivityStore.createStore>;
  let broadcast!: ReturnType<typeof ProfileStore.createStore>;

  return {
    getTitle() {
      return 'isomorphic-stores demo';
    },

    getHeadStylesheets() {
      return [{ text: `
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; background: #11111b; font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #cdd6f4; }
        code {
          font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
          background: #313244; padding: 2px 6px; border-radius: 4px; font-size: 0.875em; color: #cba6f7;
        }
        button {
          background: #313244; color: #cdd6f4; border: 1px solid #45475a;
          border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer;
          transition: background 0.15s; white-space: nowrap;
        }
        button:hover { background: #45475a; }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        input {
          background: #313244; border: 1px solid #45475a; color: #cdd6f4;
          border-radius: 6px; padding: 6px 10px; font-size: 13px; outline: none;
        }
        input:focus { border-color: #6c7086; }
        input::placeholder { color: #585b70; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        ` }];
    },

    handleRoute() {
      profile1 = ProfileStore.createStore({ userId: 1 });
      theme1 = ThemeStore.createStore({ userId: 1 });
      activity = ActivityStore.createStore({});
      broadcast = ProfileStore.createStore({ userId: 3 });
      return { status: 200 };
    },

    getElements() {
      return [
        <RootContainer style={{ maxWidth: 960, margin: '0 auto', padding: '40px 20px' }}>
          <div>
            <h1 style={{ color: '#cba6f7', margin: '0 0 6px', fontSize: '28px' }}>isomorphic-stores</h1>
            <p style={{ color: '#6c7086', margin: '0 0 40px', fontSize: '15px', lineHeight: 1.6 }}>
              Framework-agnostic SSR state management. Stores are created server-side,
              async data is declared via <code>waitFor</code>, and the SSR framework blocks
              rendering until the store is ready. Roots stream in progressively; <code>TheFold</code>
              {' '}triggers client bootstrap before all roots have arrived.
            </p>
          </div>
          <RootContainer style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 32, alignItems: 'start' }}>
            <RootContainer>
              <StoreRoot stores={[profile1]}>
                <User />
              </StoreRoot>
              <StoreRoot stores={[theme1]}>
                <Prefs />
              </StoreRoot>
              <StoreRoot stores={[activity]}>
                <Activity />
              </StoreRoot>
              <TheFold />
              <StoreRoot stores={[broadcast]}>
                <Broadcast />
              </StoreRoot>
            </RootContainer>
            <RootContainer style={{ position: 'sticky', top: 24 }}>
              <LatencyControls />
            </RootContainer>
          </RootContainer>
        </RootContainer>,
      ];
    },
  };
});
