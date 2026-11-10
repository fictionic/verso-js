import { test as base, expect } from '@playwright/test';
import { versoFixtures, type VersoHandle } from '@verso-js/playwright';

type TestFixtures = {
  verso: VersoHandle;
  consoleErrors: string[];
};

export const test = base.extend<TestFixtures>({
  // `verso` exposes the VersoHandle (waitForNavigationIdle / expectNavigation) for
  // awaiting in-page client transitions, which `page.goto` does not cover.
  verso: versoFixtures.verso,

  // Hydration-aware page: a plain `await page.goto(url)` waits for the client to
  // finish hydrating before returning (via window.__versoNavigation).
  page: versoFixtures.page,

  // Collects console.error / pageerror and auto-asserts the array is empty after
  // each test.
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err.message}`);
    });
    await use(errors);
    expect(errors, 'Expected no browser errors').toEqual([]);
  },
});

export { expect };
