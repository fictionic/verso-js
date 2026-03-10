import {defineZustandIsoStore} from "../adapters/zustand";

interface PrefsOpts {
  userId: number;
}

interface PrefsState {
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}

// Server-rendered store: waitFor blocks SSR render until theme preference is fetched.
export default defineZustandIsoStore<PrefsOpts, PrefsState>(
  ({ userId }, waitFor) => (
    (set) => ({
      ...waitFor('theme', fetchUserTheme(userId), 'light'),
      setTheme: (theme) => set({ theme }),
    })
  )
);

async function fetchUserTheme(userId: number): Promise<'light' | 'dark'> {
  // imagine an API call here
  return 'dark';
}
