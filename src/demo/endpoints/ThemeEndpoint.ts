import { defineEndpoint } from '@/sluice/Endpoint';
import { delay } from '../delay';
import { cookieLatency } from './cookieLatency';

export default defineEndpoint((ctx) => {
  let userId: number;
  return {
    async getRouteDirective() {
      userId = Number(ctx.getRequest().getParams()['userId']);
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
