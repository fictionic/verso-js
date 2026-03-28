import { test as base, expect } from '@playwright/test';

type TestFixtures = {
  consoleErrors: string[];
};

export const test = base.extend<TestFixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      errors.push(`pageerror: ${err.message}`);
    });
    await use(errors);
    expect(errors, 'Expected no browser errors').toEqual([]);
  },

  page: async ({ page }, use) => {
    // Set all latency cookies to 10ms before each test
    await page.context().addCookies([
      { name: 'latency_users', value: '10', domain: 'localhost', path: '/' },
      { name: 'latency_theme', value: '10', domain: 'localhost', path: '/' },
      { name: 'latency_activity', value: '10', domain: 'localhost', path: '/' },
    ]);
    // patch page methods to support waiting for verso client hydration
    const STATE_HYDRATED = 'hydrated';
    // patch waitForLoadState
    const realWaitForLoadState = page.waitForLoadState.bind(page);
    type StandardLoadState = Parameters<typeof realWaitForLoadState>[0];
    type LoadState = StandardLoadState | typeof STATE_HYDRATED;
    type WaitForLoadStateOptions = Parameters<typeof realWaitForLoadState>[1];
    const patchedWaitForLoadState = async (state: LoadState = STATE_HYDRATED, options?: WaitForLoadStateOptions) => {
      if (state === STATE_HYDRATED) {
        await realWaitForLoadState('domcontentloaded', options);
        await page.waitForFunction(() => !!(window as any).CLIENT_READY_DFD);
        await page.evaluate(async () => await (window as any).CLIENT_READY_DFD!.promise)
      } else {
        await realWaitForLoadState(state, options);
      }
    };
    page.waitForLoadState = patchedWaitForLoadState;
    // patch goto
    const realGoto = page.goto.bind(page);
    type StandardGotoOptions = Parameters<typeof realGoto>[1];
    type StandardWaitUntil = NonNullable<StandardGotoOptions>['waitUntil'];
    type PatchedWaitUntil = StandardWaitUntil | typeof STATE_HYDRATED;
    type PatchedGotoOptions = Omit<StandardGotoOptions, 'waitUntil'> & {
      waitUntil?: PatchedWaitUntil;
    };
    page.goto = async (url: string, options?: PatchedGotoOptions) => {
      const waitUntil = options?.waitUntil ?? STATE_HYDRATED;
      const response = await realGoto(url, {
        ...options,
        waitUntil: waitUntil === STATE_HYDRATED ? 'commit' : waitUntil,
      });
      if (waitUntil === STATE_HYDRATED) {
        await patchedWaitForLoadState(STATE_HYDRATED)
      }
      return response;
    };
    // Forward browser console and errors for debugging
    page.on('console', msg => console.log(`[browser:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => console.error(`[browser:pageerror]`, err));
    await use(page);
  },
});

export { expect };
