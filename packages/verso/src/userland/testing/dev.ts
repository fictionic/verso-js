import { afterAll, beforeAll, describe } from 'vitest';

export function devOnly(fn: () => void): void {
  describe('(dev)', () => {
    beforeAll(() => {
      globalThis.IS_DEV = true;
    });
    afterAll(() => {
      globalThis.IS_DEV = false;
    });
    fn();
  });
}
