import { defineEndpoint } from '@verso-js/verso';

// the playwright webServer waits for a non-error response at `/`
export default defineEndpoint(() => ({
  getRouteDirective: () => ({ kind: 'ok' }),
  getContentType: () => 'text/plain',
  getResponseData: () => 'ok',
}));
