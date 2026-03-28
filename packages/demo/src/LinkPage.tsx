import React from 'react';
import { RootContainer, definePage } from '@verso-js/verso';

export default definePage(() => ({
  getTitle() {
    return 'Link Page';
  },

  getStylesheets() {
    return [{ text: `
      body { margin: 0; background: #11111b; font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #cdd6f4; }
      a { color: #cba6f7; }
    ` }];
  },

  getRouteDirective() {
    return { status: 200 };
  },

  getElements() {
    return [
      <RootContainer style={{ maxWidth: 960, margin: '0 auto', padding: '40px 20px' }}>
        <h1 style={{ color: '#cba6f7', margin: '0 0 16px', fontSize: '28px' }}>Link Page</h1>
        <a href="/">Back to demo</a>
      </RootContainer>,
    ];
  },
}));
