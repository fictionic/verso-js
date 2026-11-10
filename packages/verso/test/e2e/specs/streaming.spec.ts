import { test, expect } from '../helpers/fixtures';

// Suite 15: Streaming smoke. The wire-level streaming/timeout/fold contract is
// asserted at the byte level by Suite 1 §2 and Suite 22; this is the one
// end-to-end case that the assembled streaming path works in a real browser —
// a multi-root page whose slow root is gated on a delayed endpoint still
// assembles and becomes interactive. Tagged @smoke so the prod (built-adapter)
// config runs it too, exercising the streamed manifest, /__verso/bundles/ asset
// URLs, and hydration.
test('streams a multi-root page and hydrates in the browser @smoke', async ({ page }) => {
  await page.goto('/slow-root');

  // The fast root rendered immediately; the slow root's content arrives after
  // its endpoint delay (~500ms). page.goto already waited for hydration, so
  // both roots are present by now.
  await expect(page.getByTestId('fast-root')).toContainText('Fast Root');
  await expect(page.getByTestId('slow-root')).toContainText('Slow Root');

  // Interactive/hydrated: the shared Nav is a client-hydrated region.
  await expect(page.getByTestId('nav')).toBeVisible();

  // No console errors — asserted by the consoleErrors fixture after the test.
});
