import { defineEndpoint } from '@/sluice/Endpoint';
import { getCurrentRequestContext } from '@/sluice/core/RequestContext';
import { delay } from '../delay';
import { cookieLatency } from './cookieLatency';

export default defineEndpoint(() => {
  let userId: number;
  return {
    async handleRoute() {
      const ctx = getCurrentRequestContext();
      userId = Number(ctx.routeParams['userId']);
      await delay(cookieLatency('theme', 400));
      return { status: 200 };
    },

    getContentType() {
      return 'application/json';
    },

    getResponseData() {
      return JSON.stringify({
        theme: userId % 2 === 0 ? 'light' : 'dark',
        accent: '#6366f1',
      });
    },
  };
});
