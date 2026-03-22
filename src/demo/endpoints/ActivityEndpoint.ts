import { defineEndpoint } from '@/sluice/Endpoint';
import { delay } from '../delay';
import { cookieLatency } from './cookieLatency';

export default defineEndpoint(() => ({
  async handleRoute() {
    await delay(cookieLatency('activity', 1500));
    return { status: 200 };
  },

  getContentType() {
    return 'application/json';
  },

  getResponseData() {
    return JSON.stringify({
      items: [
        'Edited profile settings',
        'Uploaded a photo',
        'Sent a message to Bob',
        'Updated notification preferences',
        'Joined #general channel',
      ],
    });
  },
}));
