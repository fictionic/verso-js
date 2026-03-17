import { defineZustandIsoStore } from './define';
import { fetch } from '@/sluice/core/fetch';

interface ProfileState {
  username: string;
  email: string;
  rename: (name: string) => void;
}

export type ProfileMessage =
  | { type: 'rename'; name: string }
  | { type: 'reset' };

export const ProfileStore = defineZustandIsoStore<
  { userId: number },
  ProfileState,
  ProfileMessage
>(
  ({ userId }, { waitFor, onMessage }) =>
    (set) => {
      let initialUsername = '';
      let initialEmail = '';

      onMessage((msg) => {
        if (msg.type === 'rename') set({ username: msg.name });
        if (msg.type === 'reset') set({ username: initialUsername, email: initialEmail });
      });

      const userPromise = fetch(`/api/users/${userId}`)
        .then(res => res.json() as Promise<{ username: string; email: string }>)
        .then((d) => {
          initialUsername = d.username;
          initialEmail = d.email;
          return d;
        });

      return {
        ...waitFor('username', userPromise.then((d) => d.username), ''),
        ...waitFor('email', userPromise.then((d) => d.email), ''),
        rename: (name) => set({ username: name }),
      };
    },
  { onError: (err) => console.error('[ProfileStore]', err) },
);
