import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';

// Suite 16: Fetch isomorphism. The server-side fetch of `/api/data` (a loopback
// fetch, invisible to the browser) is cached, dehydrated at the fold, and
// replayed from cache on the client — so a fresh pageload makes *zero* browser
// requests to the endpoint. A subsequent client-side navigation back to the
// page re-runs the handler chain client-side; that fetch is a cache miss and
// falls through to a real browser request. Both properties are only observable
// with real network interception, so they live in Playwright rather than the
// integration suites.

// Counts browser network requests to `/api/data`, letting them continue so the
// endpoint still responds. Install before the navigation you want to measure.
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

  // The server fetch was replayed from the dehydrated cache; the rendered data
  // is present without the browser ever hitting the endpoint.
  await expect(page.getByTestId('fetch-data-name')).toHaveText('Ada Lovelace');
  expect(requests.count()).toBe(0);
});

test('client-side navigation triggers a fresh client fetch', async ({ page, verso }) => {
  // Land on a page that doesn't fetch `/api/data`, so the interceptor starts clean.
  await page.goto('/basic');

  const requests = await countApiDataRequests(page);
  expect(requests.count()).toBe(0);

  // Navigate to /fetch-data via the shared Nav link — an in-page client
  // transition. Arm the wait before the click so a fast transition can't be
  // missed. The client re-runs the handler chain; the fetch misses the cache
  // and falls through to a real browser request.
  const { waitForIdle } = await verso.expectNavigation();
  await page.getByTestId('nav-fetch-data').click();
  await waitForIdle();

  await expect(page.getByTestId('fetch-data-name')).toHaveText('Ada Lovelace');
  expect(requests.count()).toBeGreaterThan(0);
});
