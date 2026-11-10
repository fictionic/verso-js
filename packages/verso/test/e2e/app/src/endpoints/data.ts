import { defineEndpoint } from '@verso-js/verso';

// JSON endpoint backing the fetch-data page.
export default defineEndpoint(() => ({
  getRouteDirective: () => ({ kind: 'ok' }),
  getContentType: () => 'application/json',
  getResponseData: () => JSON.stringify({ name: 'Ada Lovelace', id: 42 }),
}));
