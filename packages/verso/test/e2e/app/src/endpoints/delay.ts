import { defineEndpoint } from '@verso-js/verso';

function delayMs(url: string): number {
  const ms = Number(new URL(url).searchParams.get('ms'));
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export default defineEndpoint(({ getRequest }) => ({
  async getRouteDirective() {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs(getRequest().url)));
    return { kind: 'ok' };
  },
  getContentType: () => 'application/json',
  getResponseData: () => JSON.stringify({ delayed: true }),
}));
