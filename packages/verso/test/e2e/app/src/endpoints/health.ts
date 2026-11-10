import { defineEndpoint } from '@verso-js/verso';

// No-op endpoint at `/` so the webServer health check gets a 200. The fixture
// has no other root route, and Playwright only treats <400 as "ready" — without
// this, `/` would 404 forever and the webServer would time out.
export default defineEndpoint(() => ({
  getRouteDirective: () => ({ kind: 'ok' }),
  getContentType: () => 'text/plain',
  getResponseData: () => 'ok',
}));
