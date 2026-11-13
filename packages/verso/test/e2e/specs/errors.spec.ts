import { test as base, expect } from '../helpers/fixtures';

// the Boom root logs an intentional error, so this spec allows only that error
const INTENTIONAL_ERROR = '[fixture] intentional render error from error-root page';

const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err.message}`);
    });
    await use(errors);
    const unexpected = errors.filter((e) => !e.includes(INTENTIONAL_ERROR));
    expect(unexpected, 'Expected no unexpected browser errors').toEqual([]);
  },
});

test('one root render error does not break sibling roots', async ({ page }) => {
  await page.goto('/error-root');

  await expect(page.getByTestId('good-root')).toContainText('Good Root');

  // the click works only after hydration
  const counter = page.getByTestId('error-page-counter');
  await expect(counter).toContainText('count: 0');
  await counter.click();
  await expect(counter).toContainText('count: 1');
});
