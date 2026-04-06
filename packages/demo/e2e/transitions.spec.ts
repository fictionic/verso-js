import { test, expect } from './helpers/fixtures';

/**
 * Wait for a client-side navigation to complete.
 * navigate() resets CLIENT_READY_DFD — wait for the new one to resolve.
 */
async function waitForTransition(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => (window as any).CLIENT_READY_DFD?.promise?.then(() => true, () => false),
    null,
    { timeout: 10_000 },
  );
  await page.evaluate(() => (window as any).CLIENT_READY_DFD.promise);
}

/** Trigger a client-side navigation via the exposed controller. */
async function navigateTo(page: import('@playwright/test').Page, url: string) {
  await page.evaluate((u) => (window as any).__versoController.navigate(u), url);
  await waitForTransition(page);
}

test.describe('Client-side transitions', () => {
  test.describe('basic navigation', () => {
    test('navigate from DemoPage to LinkPage via button', async ({ page }) => {
      await page.goto('/');

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);

      await expect(page.locator('h1')).toHaveText('Link Page');
      expect(page.url()).toContain('/link');
    });

    test('navigate from LinkPage to DemoPage', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);

      await navigateTo(page, '/');

      await expect(page.locator('.demo-header-title')).toHaveText('isomorphic-stores');
      expect(page.url()).not.toContain('/link');
    });

    test('multiple sequential navigations', async ({ page }) => {
      await page.goto('/');

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await expect(page.locator('h1')).toHaveText('Link Page');

      await navigateTo(page, '/');
      await expect(page.locator('.demo-header-title')).toHaveText('isomorphic-stores');

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await expect(page.locator('h1')).toHaveText('Link Page');
    });

    test('no full page reload on navigateTo', async ({ page }) => {
      await page.goto('/');

      // mark the window so we can detect a full reload
      await page.evaluate(() => (window as any).__transitionMarker = true);

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);

      const markerSurvived = await page.evaluate(() => (window as any).__transitionMarker === true);
      expect(markerSurvived).toBe(true);
    });
  });

  test.describe('document title', () => {
    test('title updates on forward navigation', async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle('isomorphic-stores demo');

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await expect(page).toHaveTitle('Link Page');
    });

    test('title updates on backward navigation', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await expect(page).toHaveTitle('Link Page');

      await navigateTo(page, '/');
      await expect(page).toHaveTitle('isomorphic-stores demo');
    });
  });

  test.describe('history / popstate', () => {
    test('browser back navigates to previous page', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await expect(page.locator('h1')).toHaveText('Link Page');

      await page.goBack();
      await waitForTransition(page);

      await expect(page.locator('.demo-header-title')).toHaveText('isomorphic-stores');
      await expect(page).toHaveTitle('isomorphic-stores demo');
    });

    test('browser forward after back', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);

      await page.goBack();
      await waitForTransition(page);
      await expect(page.locator('.demo-header-title')).toHaveText('isomorphic-stores');

      await page.goForward();
      await waitForTransition(page);
      await expect(page.locator('h1')).toHaveText('Link Page');
      await expect(page).toHaveTitle('Link Page');
    });

    test('back does not trigger full reload', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => (window as any).__transitionMarker = true);

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);

      await page.goBack();
      await waitForTransition(page);

      const markerSurvived = await page.evaluate(() => (window as any).__transitionMarker === true);
      expect(markerSurvived).toBe(true);
    });
  });

  test.describe('content rendering', () => {
    test('DemoPage content appears after navigating back', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);

      await navigateTo(page, '/');

      await expect(page.locator('[data-card="User Profile"]')).toBeVisible();
      await expect(page.locator('[data-card="Preferences"]')).toBeVisible();
      await expect(page.locator('[data-card="Activity"]')).toBeVisible();
      await expect(page.locator('[data-card="Broadcast / onMessage"]')).toBeVisible();
    });

    test('DemoPage content is removed on navigate to LinkPage', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('[data-card="User Profile"]')).toBeVisible();

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);

      await expect(page.locator('[data-card="User Profile"]')).toHaveCount(0);
      await expect(page.locator('[data-card="Preferences"]')).toHaveCount(0);
      await expect(page.locator('h1')).toHaveText('Link Page');
      await expect(page.getByText('Back to demo')).toBeVisible();
    });

    test('middleware header renders on both pages', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('header')).toContainText('my cool header');

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await expect(page.locator('header')).toContainText('my cool header');
    });

    test('store data loads after client navigation to DemoPage', async ({ page }) => {
      await page.goto('/link');

      await navigateTo(page, '/');

      const card = page.locator('[data-card="User Profile"]');
      await expect(card.getByText('Alice', { exact: true })).toBeVisible({ timeout: 5000 });
      await expect(card.getByText('user1@example.com')).toBeVisible();
    });
  });

  test.describe('styles', () => {
    test('page-specific styles apply after navigation', async ({ page }) => {
      await page.goto('/');

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);

      // link-page.css defines .link-page-title with color #cba6f7 = rgb(203, 166, 247)
      const linkTitleColor = await page.locator('.link-page-title').evaluate(
        (el) => getComputedStyle(el).color,
      );
      expect(linkTitleColor).toBe('rgb(203, 166, 247)');
    });

    test('shared base styles persist across navigation', async ({ page }) => {
      await page.goto('/');
      const bgBefore = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);

      const bgAfter = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      // base.css: #11111b = rgb(17, 17, 27)
      expect(bgBefore).toBe(bgAfter);
      expect(bgAfter).toBe('rgb(17, 17, 27)');
    });
  });

  test.describe('state isolation', () => {
    test('store mutations do not persist across round-trip navigation', async ({ page }) => {
      await page.goto('/');
      const card = page.locator('[data-card="User Profile"]');

      // mutate store state
      await card.getByPlaceholder('New username...').fill('Modified');
      await card.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect(card.getByText('Modified')).toBeVisible();

      // navigate away and back
      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await navigateTo(page, '/');

      // store should have fresh data from a new fetch, not the mutated value
      await expect(card.getByText('Alice', { exact: true })).toBeVisible({ timeout: 5000 });
    });

    test('activity counter resets after round-trip navigation', async ({ page }) => {
      await page.goto('/');
      const card = page.locator('[data-card="Activity"]');

      await card.getByRole('button', { name: '+1' }).click();
      await card.getByRole('button', { name: '+1' }).click();
      await expect(card.getByText('2')).toBeVisible();

      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await navigateTo(page, '/');

      await expect(card.getByText('0')).toBeVisible();
    });
  });

  test.describe('interactivity after navigation', () => {
    test('components are interactive after client-side navigation', async ({ page }) => {
      await page.goto('/link');

      await navigateTo(page, '/');

      const card = page.locator('[data-card="User Profile"]');
      await expect(card.getByText('Alice', { exact: true })).toBeVisible({ timeout: 5000 });
      await card.getByPlaceholder('New username...').fill('NavUser');
      await card.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect(card.getByText('NavUser')).toBeVisible();
    });

    test('NAVIGATE button works after a round-trip', async ({ page }) => {
      await page.goto('/');

      // first trip
      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await navigateTo(page, '/');

      // second trip — button should still work
      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await expect(page.locator('h1')).toHaveText('Link Page');
    });

    test('theme toggle works after navigation back to DemoPage', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'NAVIGATE' }).click();
      await waitForTransition(page);
      await navigateTo(page, '/');

      const card = page.locator('[data-card="Preferences"]');
      await expect(card.getByText('Theme: dark')).toBeVisible({ timeout: 5000 });
      await card.getByRole('button', { name: 'Light', exact: true }).click();
      await expect(card.getByText('Theme: light')).toBeVisible();
    });
  });
});
