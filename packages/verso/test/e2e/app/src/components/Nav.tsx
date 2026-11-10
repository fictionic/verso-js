import { Link } from '@verso-js/verso';

// Shared in-page navigation. Every page carries it so the navigation suites
// (back/forward across 3+ pages, navigateTo, portal survives-nav) always have
// links to click and destinations to reach.
export function Nav() {
  return (
    <nav data-testid="nav">
      <Link href="/basic" data-testid="nav-basic">Basic</Link>{' '}
      <Link href="/multi-root" data-testid="nav-multi-root">Multi Root</Link>{' '}
      <Link href="/nav-target" data-testid="nav-nav-target">Nav Target</Link>{' '}
      <Link href="/fetch-data" data-testid="nav-fetch-data">Fetch Data</Link>{' '}
      <Link href="/portal" data-testid="nav-portal">Portal</Link>
    </nav>
  );
}
