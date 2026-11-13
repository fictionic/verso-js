import { Link } from '@verso-js/verso';

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
