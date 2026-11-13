import { test, expect } from '../helpers/fixtures';

test('streams a multi-root page and hydrates in the browser @smoke', async ({ page }) => {
  await page.goto('/slow-root');

  await expect(page.getByTestId('fast-root')).toContainText('Fast Root');
  await expect(page.getByTestId('slow-root')).toContainText('Slow Root');
  await expect(page.getByTestId('nav')).toBeVisible();
});
