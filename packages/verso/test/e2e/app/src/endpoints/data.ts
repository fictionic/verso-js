import { defineEndpoint } from '@verso-js/verso';

export default defineEndpoint(() => ({
  getRouteDirective: () => ({ kind: 'ok' }),
  getContentType: () => 'application/json',
  getResponseData: () => JSON.stringify({ name: 'Ada Lovelace', id: 42 }),
}));
