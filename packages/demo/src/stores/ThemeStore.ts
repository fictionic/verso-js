import { defineZustandIsoStore } from './define';
import { asSingleton } from '@verso-js/stores';
import { fetch } from '@verso-js/verso';

interface ThemeState {
  theme: 'light' | 'dark';
  accent: string;
  setTheme: (theme: 'light' | 'dark') => void;
  setAccent: (accent: string) => void;
}

export const ThemeStore = asSingleton(defineZustandIsoStore<{ userId: number }, ThemeState>(
  ({ userId }, { setAsync }) =>
    (set) => {
      const themePromise = fetch(`/api/theme/${userId}`)
        .then(res => res.json() as Promise<{ theme: 'light' | 'dark'; accent: string }>);
      return {
        ...setAsync('theme', themePromise.then((d) => d.theme)),
        ...setAsync('accent', themePromise.then((d) => d.accent)),
        setTheme: (theme) => set({ theme }),
        setAccent: (accent) => set({ accent }),
      };
    },
  { onError: (err) => console.error('[ThemeStore]', err) },
));
