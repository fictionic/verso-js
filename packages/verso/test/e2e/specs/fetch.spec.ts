import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';

// the server fetch is a loopback fetch, so the browser never sees it
async function countApiDataRequests(page: Page): Promise<{ count: () => number }> {
  let count = 0;
  await page.route('**/api/data', async (route) => {
    count += 1;
    await route.continue();
  });
  return { count: () => count };
}

test('data fetched on server is reused on the client with no duplicate request @smoke', async ({
  page,
}) => {
  const requests = await countApiDataRequests(page);

  await page.goto('/fetch-data');

  await expect(page.getByTestId('fetch-data-name')).toHaveText('Ada Lovelace');
  expect(requests.count()).toBe(0);
});

test('client-side navigation triggers a fresh client fetch', async ({ page, verso }) => {
  await page.goto('/basic');

  const requests = await countApiDataRequests(page);

  const { waitForIdle } = await verso.expectNavigation();
  await page.getByTestId('nav-fetch-data').click();
  await waitForIdle();

  await expect(page.getByTestId('fetch-data-name')).toHaveText('Ada Lovelace');
  expect(requests.count()).toBe(1);
});
