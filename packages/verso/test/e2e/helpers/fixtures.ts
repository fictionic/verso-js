import { test as base, expect } from '@playwright/test';
import { versoFixtures, type VersoHandle } from '@verso-js/playwright';

type TestFixtures = {
  verso: VersoHandle;
  consoleErrors: string[];
};

export const test = base.extend<TestFixtures>({
  verso: versoFixtures.verso,
  // page.goto waits for client hydration
  page: versoFixtures.page,
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
