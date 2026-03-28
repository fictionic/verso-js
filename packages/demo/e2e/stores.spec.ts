import { test, expect } from './helpers/fixtures';

function profileCard(page: import('@playwright/test').Page) {
  return page.locator('[data-card="User Profile"]');
}
function prefsCard(page: import('@playwright/test').Page) {
  return page.locator('[data-card="Preferences"]');
}
function activityCard(page: import('@playwright/test').Page) {
  return page.locator('[data-card="Activity"]');
}
function broadcastCard(page: import('@playwright/test').Page) {
  return page.locator('[data-card="Broadcast / onMessage"]');
}

test.describe('SSR Content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page title', async ({ page }) => {
    await expect(page).toHaveTitle('isomorphic-stores demo');
  });

  test('user profile SSR', async ({ page }) => {
    const card = profileCard(page);
    await expect(card.getByText('Alice', { exact: true })).toBeVisible();
    await expect(card.getByText('user1@example.com')).toBeVisible();
  });

  test('preferences SSR', async ({ page }) => {
    const card = prefsCard(page);
    await expect(card.getByText('Theme: dark')).toBeVisible();
    await expect(card.getByText('#6366f1')).toBeVisible();
  });

  test('activity initial state', async ({ page }) => {
    const card = activityCard(page);
    await expect(card.getByText('0')).toBeVisible();
    await expect(card.getByText('Fetching after mount...')).toBeVisible();
  });

  test('broadcast root SSR', async ({ page }) => {
    const card = broadcastCard(page);
    await expect(card.getByText('Charlie', { exact: true })).toBeVisible();
  });
});

test.describe('Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('rename via button', async ({ page }) => {
    const card = profileCard(page);
    await card.getByPlaceholder('New username...').fill('TestUser');
    await card.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(card.getByText('TestUser')).toBeVisible();
  });

  test('rename via Enter', async ({ page }) => {
    const card = profileCard(page);
    const input = card.getByPlaceholder('New username...');
    await input.fill('EnterUser');
    await input.press('Enter');
    await expect(card.getByText('EnterUser')).toBeVisible();
  });

  test('theme toggle', async ({ page }) => {
    const card = prefsCard(page);
    await expect(card.getByText('Theme: dark')).toBeVisible();
    await card.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(card.getByText('Theme: light')).toBeVisible();
    await card.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(card.getByText('Theme: dark')).toBeVisible();
  });

  test('accent picker', async ({ page }) => {
    const card = prefsCard(page);
    await expect(card.getByText('#6366f1')).toBeVisible();
    await card.locator('button[style*="#ec4899"]').click();
    await expect(card.getByText('#ec4899')).toBeVisible();
  });

  test('activity counter', async ({ page }) => {
    const card = activityCard(page);
    const plusButton = card.getByRole('button', { name: '+1' });
    await plusButton.click();
    await plusButton.click();
    await plusButton.click();
    await expect(card.getByText('3')).toBeVisible();
  });
});

test.describe('Client-only async data', () => {
  test('activity items load', async ({ page }) => {
    await page.goto('/');
    const card = activityCard(page);
    await expect(card.getByText('Fetching after mount...')).toBeHidden({ timeout: 5000 });
    await expect(card.getByText('Edited profile settings')).toBeVisible();
    await expect(card.getByText('Uploaded a photo')).toBeVisible();
    await expect(card.getByText('Sent a message to Bob')).toBeVisible();
    await expect(card.getByText('Updated notification preferences')).toBeVisible();
    await expect(card.getByText('Joined #general channel')).toBeVisible();
  });
});

test.describe('Cross-root broadcast', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('broadcast rename', async ({ page }) => {
    await page.getByRole('button', { name: /rename → "Zara"/ }).click();
    await expect(profileCard(page).getByText('Zara', { exact: true })).toBeVisible();
    await expect(broadcastCard(page).getByText('Zara', { exact: true })).toBeVisible();
  });

  test('broadcast reset', async ({ page }) => {
    await page.getByRole('button', { name: /rename → "Zara"/ }).click();
    await expect(profileCard(page).getByText('Zara', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /reset all/ }).click();
    await expect(profileCard(page).getByText('Alice', { exact: true })).toBeVisible();
    await expect(broadcastCard(page).getByText('Charlie', { exact: true })).toBeVisible();
  });
});

test.describe('Streaming', () => {
  test('progressive streaming', async ({ page }) => {
    await page.context().addCookies([
      { name: 'latency_users', value: '800', domain: 'localhost', path: '/' },
      { name: 'latency_theme', value: '800', domain: 'localhost', path: '/' },
    ]);

    await page.goto('/', { waitUntil: 'commit' });
    await expect(page).toHaveTitle('isomorphic-stores demo');
    await expect(profileCard(page).getByText('Alice', { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
