import { test as base, expect } from '../helpers/fixtures';

// Suite 17: Error recovery smoke. The 404/500 wire responses (Suite 1 §1 +
// Suite 21), the server-side single-root render fallback (Suite 1 §2), and the
// client-side "already-hydrated roots stay functional after another root's
// error" (Suite 5) are all owned elsewhere. What only a real browser can show
// is that a full pageload survives one root throwing while its siblings stay
// interactive — this is that one smoke.

// The `<Boom />` root throws on purpose; verso logs that intentional render
// error. Override the fixture's `consoleErrors` for this spec so the known log
// is allowed through, while any *other* browser error still fails the test (a
// total page failure or a hydration-mismatch is not tolerated).
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

  // The good root rendered and its content is present — the throwing sibling
  // root did not take the page down.
  await expect(page.getByTestId('good-root')).toContainText('Good Root');

  // And it hydrated: the counter inside it is interactive (its click handler
  // only works post-hydration).
  const counter = page.getByTestId('error-page-counter');
  await expect(counter).toContainText('count: 0');
  await counter.click();
  await expect(counter).toContainText('count: 1');
});
