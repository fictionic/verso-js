import type { JSHandle, Page } from '@playwright/test';

const STATE_HYDRATED = 'hydrated';

type StandardLoadState = Parameters<Page['waitForLoadState']>[0];
type LoadState = StandardLoadState | typeof STATE_HYDRATED;
type WaitForLoadStateOptions = Parameters<Page['waitForLoadState']>[1];

type StandardGotoOptions = Parameters<Page['goto']>[1];
type StandardWaitUntil = NonNullable<StandardGotoOptions>['waitUntil'];
type PatchedWaitUntil = StandardWaitUntil | typeof STATE_HYDRATED;
type PatchedGotoOptions = Omit<StandardGotoOptions, 'waitUntil'> & {
  waitUntil?: PatchedWaitUntil;
};

export interface VersoHandle {
  /**
   * Waits for any ongoing navigation to settle.
   */
  waitForNavigationIdle(): Promise<void>;
  /**
   * Starts waiting for a navigation that is not currently ongoing.
   * Resolves with an object containing a function that, when called, resolves
   * when a new navigation has started and settled.
   */
  expectNavigation(): Promise<{ waitForIdle: () => Promise<void> }>;
};

export const versoFixtures = {
  verso: async ({ page }: { page: Page }, use: (verso: VersoHandle) => Promise<void>) => {
    await use(createVersoHandle(page));
  },
  page: async ({ page }: { page: Page }, use: (page: Page) => Promise<void>) => {
    const verso = createVersoHandle(page);
    const realWaitForLoadState = page.waitForLoadState.bind(page);
    const patchedWaitForLoadState = async (state: LoadState = STATE_HYDRATED, options?: WaitForLoadStateOptions) => {
      if (state === STATE_HYDRATED) {
        await realWaitForLoadState('domcontentloaded', options);
        await verso.waitForNavigationIdle();
      } else {
        await realWaitForLoadState(state, options);
      }
    };
    page.waitForLoadState = patchedWaitForLoadState;

    const realGoto = page.goto.bind(page);
    page.goto = async (url: string, options?: PatchedGotoOptions) => {
      const waitUntil = options?.waitUntil ?? STATE_HYDRATED;
      const response = await realGoto(url, {
        ...options,
        waitUntil: waitUntil === STATE_HYDRATED ? 'commit' : waitUntil,
      });
      if (waitUntil === STATE_HYDRATED) {
        await patchedWaitForLoadState(STATE_HYDRATED);
      }
      return response;
    };

    await use(page);
  },
};

// The handle is stateless, so each fixture makes its own. If `page` depended on
// `verso`, Playwright would reject the page -> verso -> page cycle.
function createVersoHandle(page: Page): VersoHandle {
  return {
    waitForNavigationIdle: async () => {
      const navHandle = await getVersoNavigationHandle(page);
      // wrap the promise in an object so playwright doesn't await it
      const promiseHandle = await navHandle.evaluateHandle((nav) => ({ promise: nav.waitForIdle() }));
      await navHandle.dispose();
      await promiseHandle.evaluate(({ promise }) => promise);
      await promiseHandle.dispose();
    },
    expectNavigation: async () => {
      const navHandle = await getVersoNavigationHandle(page);
      // wrap the promise in an object so playwright doesn't await it
      const promiseHandle = await navHandle.evaluateHandle((nav) => ({ promise: nav.waitForNextIdle() }));
      await navHandle.dispose();
      return {
        waitForIdle: async () => {
          await promiseHandle.evaluate(({ promise }) => promise);
          await promiseHandle.dispose();
        },
      };
    },
  };
}

async function getVersoNavigationHandle(page: Page): Promise<JSHandle<VersoNavigationGlobal>> {
  await page.waitForFunction(() => !!window.__versoNavigation);
  return await page.evaluateHandle<VersoNavigationGlobal>(() => window.__versoNavigation);
}
