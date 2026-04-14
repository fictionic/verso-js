import { getCookie } from '@verso-js/verso';

export function cookieLatency(key: string, fallback: number): number {
  const val = getCookie(`latency_${key}`);
  return val ? Number(val) || fallback : fallback;
}
