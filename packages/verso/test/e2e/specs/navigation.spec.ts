import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';

// Suite 19: Navigation (E2E). Real browser history (back/forward) driving verso
// client transitions, plus a smoke for the programmatic `navigateTo()` entry
// point. The rapid-click race is owned by Suite 28 (jsdom); <base>/meta swaps
// are a jsdom transitioner concern.

// A full reload replaces `window`, so a marker set on it survives only client
// transitions. Set it once after the first pageload, then check it after each
// step to prove no step reloaded the document.
async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __suite19Marker?: boolean }).__suite19Marker = true;
  });
}

async function expectSameDocument(page: Page) {
  const marker = await page.evaluate(
    () => (window as unknown as { __suite19Marker?: boolean }).__suite19Marker,
  );
  expect(marker, 'expected a client transition, not a full reload').toBe(true);
}

async function expectBasic(page: Page) {
  await expect(page).toHaveURL(/\/basic$/);
  await expect(page).toHaveTitle('Basic Page');
  await expect(page.getByTestId('basic-heading')).toBeVisible();
  await expect(page.getByTestId('root-one')).toHaveCount(0);
  await expect(page.getByTestId('nav-target-heading')).toHaveCount(0);
  await expectSameDocument(page);
}

async function expectMultiRoot(page: Page) {
  await expect(page).toHaveURL(/\/multi-root$/);
  await expect(page).toHaveTitle('Multi Root Page');
  await expect(page.getByTestId('root-one')).toBeVisible();
  await expect(page.getByTestId('root-two')).toBeVisible();
  await expect(page.getByTestId('basic-heading')).toHaveCount(0);
  await expect(page.getByTestId('nav-target-heading')).toHaveCount(0);
  await expectSameDocument(page);
}

async function expectNavTarget(page: Page) {
  await expect(page).toHaveURL(/\/nav-target$/);
  await expect(page).toHaveTitle('Nav Target Page');
  await expect(page.getByTestId('nav-target-heading')).toHaveText('Nav Target');
  await expect(page.getByTestId('basic-heading')).toHaveCount(0);
  await expect(page.getByTestId('root-one')).toHaveCount(0);
  await expectSameDocument(page);
}

test('browser back/forward across 3 pages transitions on the client', async ({ page, verso }) => {
  // Arm before each action so a fast transition can't be missed.
  const step = async (action: () => Promise<unknown>) => {
    const { waitForIdle } = await verso.expectNavigation();
    await action();
    await waitForIdle();
  };

  await page.goto('/basic');
  await markDocument(page);
  await expectBasic(page);

  // Build a 3-entry history with Link transitions.
  await step(() => page.getByTestId('nav-multi-root').click());
  await expectMultiRoot(page);
  await step(() => page.getByTestId('nav-nav-target').click());
  await expectNavTarget(page);

  // Walk back to the start...
  await step(() => page.goBack());
  await expectMultiRoot(page);
  await step(() => page.goBack());
  await expectBasic(page);

  // ...and forward to the end again.
  await step(() => page.goForward());
  await expectMultiRoot(page);
  await step(() => page.goForward());
  await expectNavTarget(page);

  // The final page hydrated: its Counter is interactive.
  await page.getByTestId('nav-target-counter').click();
  await expect(page.getByTestId('nav-target-counter')).toHaveText('count: 1');
});

test('navigateTo() performs a client transition @smoke', async ({ page, verso }) => {
  await page.goto('/basic');
  await markDocument(page);

  const { waitForIdle } = await verso.expectNavigation();
  await page.getByTestId('basic-navigate-to').click();
  await waitForIdle();

  await expectNavTarget(page);

  // The new root is live after the transition.
  await page.getByTestId('nav-target-counter').click();
  await expect(page.getByTestId('nav-target-counter')).toHaveText('count: 1');
});
