import { defineZustandIsoStore } from './define';
import { fetch } from '@verso-js/verso/fetch';

interface ThemeState {
  theme: 'light' | 'dark';
  accent: string;
  setTheme: (theme: 'light' | 'dark') => void;
  setAccent: (accent: string) => void;
}

export const ThemeStore = defineZustandIsoStore<{ userId: number }, ThemeState>(
  ({ userId }, { waitFor }) =>
    (set) => {
      const themePromise = fetch(`/api/theme/${userId}`)
        .then(res => res.json() as Promise<{ theme: 'light' | 'dark'; accent: string }>);
      return {
        ...waitFor('theme', themePromise.then((d) => d.theme), 'light' as 'light' | 'dark'),
        ...waitFor('accent', themePromise.then((d) => d.accent), '#6366f1'),
        setTheme: (theme) => set({ theme }),
        setAccent: (accent) => set({ accent }),
      };
    },
  { onError: (err) => console.error('[ThemeStore]', err) },
);
