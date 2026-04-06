import React, { useState } from 'react';
import { ProfileStore } from '../stores';
import { Card, Panel, Label } from './ui';
import {navigateTo} from '@verso-js/verso';

export function User() {
  const username = ProfileStore.hooks.useStore((s) => s.username);
  const email = ProfileStore.hooks.useStore((s) => s.email);
  const rename = ProfileStore.hooks.useStore((s) => s.rename);
  const [input, setInput] = useState('');

  return (
    <Card
      title="User Profile"
      tag="ProfileStore · waitFor"
      description={
        <>
          <code>waitFor</code> registers async promises that block <code>whenReady</code> — the SSR
          framework holds the response until resolved. Username and email are fetched server-side and
          streamed into the HTML. FOO BAR
        </>
      }
    >
      <Panel>
        <Label>profileInstance (userId: 1)</Label>
        <p style={{ margin: '0 0 4px' }}>
          <span style={{ color: '#6c7086' }}>Username: </span>
          <b style={{ color: '#cdd6f4' }}>{username}</b>
        </p>
        <p style={{ margin: '0 0 14px' }}>
          <span style={{ color: '#6c7086' }}>Email: </span>
          <span style={{ color: '#cdd6f4' }}>{email}</span>
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="New username..."
            style={{ width: 160 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && input) {
                rename(input);
                setInput('');
              }
            }}
          />
          <button
            onClick={() => {
              if (input) {
                rename(input);
                setInput('');
              }
            }}
            disabled={!input}
          >
            Rename
          </button>
          <button
            onClick={() => navigateTo('/link')}
          >
            NAVIGATE
          </button>
        </div>
      </Panel>
    </Card>
  );
}
