import { test, expect } from '../helpers/fixtures';

// Suite 24: Portal (E2E). `IsomorphicPortal` is the one userland utility whose
// correctness is only verifiable in a real browser: its server branch emits an
// inline <script> that relocates the portal content into the target selector at
// HTML parse time — before the client bundle hydrates — so the post-parse DOM
// matches the client's null → createPortal render. A real browser runs that
// inline script as the document streams in; jsdom + innerHTML (what the
// hydration harness uses) does not, so the parse-time-script-then-hydrate
// agreement can only be observed here. The zero-console-errors assertion (from
// the consoleErrors fixture) is the heart of this suite — a portal hydration
// mismatch surfaces as a React onRecoverableError / console error.
//
// Tagged @smoke so the prod (built-adapter) config runs it too: dev streams
// Vite-transformed modules while prod serves the built bundle + a real client
// manifest, and portal's relocation timing relative to hydration differs enough
// between the two to be worth both.
test('server-rendered portal relocates into the target and hydrates cleanly @smoke', async ({
  page,
}) => {
  await page.goto('/portal');

  // The parse-time relocation script ran: the content lives inside the
  // structural target container, and the portal's original envelope is gone.
  await expect(page.locator('#portal-target').getByTestId('portal-content')).toHaveText(
    'Portal content',
  );
  await expect(page.locator('[data-verso-portal-container]')).toHaveCount(0);

  // Exactly one copy — the client useEffect removed the server source node
  // rather than double-rendering via createPortal.
  await expect(page.getByTestId('portal-content')).toHaveCount(1);

  // No console errors — asserted by the consoleErrors fixture after the test.
  // This is the browser-only signal that the relocation-then-hydrate dance agreed.
});

test('portal still works after navigating away and back', async ({ page, verso }) => {
  await page.goto('/portal');
  await expect(page.locator('#portal-target').getByTestId('portal-content')).toHaveText(
    'Portal content',
  );

  // Navigate away via an in-page Link transition (arm before the click so a fast
  // transition can't be missed).
  {
    const { waitForIdle } = await verso.expectNavigation();
    await page.getByTestId('nav-basic').click();
    await waitForIdle();
  }
  await expect(page.getByTestId('portal-content')).toHaveCount(0);

  // ...and back to /portal via the shared Nav link. This exercises the
  // createPortal path under a client transition (root reuse), not just first
  // pageload.
  {
    const { waitForIdle } = await verso.expectNavigation();
    await page.getByTestId('nav-portal').click();
    await waitForIdle();
  }

  await expect(page.locator('#portal-target').getByTestId('portal-content')).toHaveText(
    'Portal content',
  );
  await expect(page.getByTestId('portal-content')).toHaveCount(1);

  // Still zero console errors after the round-trip — asserted by consoleErrors.
});
