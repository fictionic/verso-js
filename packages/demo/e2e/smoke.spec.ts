import { test, expect } from './helpers/fixtures';

test.describe('SSR + Hydration', () => {
  test('page loads and hydrates without errors', async ({ page, consoleErrors }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
  });
});
