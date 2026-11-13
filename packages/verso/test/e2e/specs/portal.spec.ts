import { test, expect } from '../helpers/fixtures';

// The main check is the consoleErrors fixture: a hydration mismatch logs an
// error. This is not a testHydration() test, because jsdom innerHTML does not
// run the inline relocation script.
test('server-rendered portal relocates into the target and hydrates cleanly @smoke', async ({
  page,
}) => {
  await page.goto('/portal');

  await expect(page.locator('#portal-target').getByTestId('portal-content')).toHaveText(
    'Portal content',
  );
  await expect(page.locator('[data-verso-portal-container]')).toHaveCount(0);
  await expect(page.getByTestId('portal-content')).toHaveCount(1);
});

test('portal still works after navigating away and back', async ({ page, verso }) => {
  await page.goto('/portal');
  await expect(page.locator('#portal-target').getByTestId('portal-content')).toHaveText(
    'Portal content',
  );

  {
    const { waitForIdle } = await verso.expectNavigation();
    await page.getByTestId('nav-basic').click();
    await waitForIdle();
  }
  await expect(page.getByTestId('portal-content')).toHaveCount(0);

  {
    const { waitForIdle } = await verso.expectNavigation();
    await page.getByTestId('nav-portal').click();
    await waitForIdle();
  }

  await expect(page.locator('#portal-target').getByTestId('portal-content')).toHaveText(
    'Portal content',
  );
  await expect(page.getByTestId('portal-content')).toHaveCount(1);
});
