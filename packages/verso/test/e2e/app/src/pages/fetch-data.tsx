import { definePage, fetch, Root, useRootData } from '@verso-js/verso';
import { Nav } from '../components/Nav';

type Data = { name: string; id: number };

// Fetches data on the server; the root is gated on the fetch via `when`, and
// the data is exposed to the tree through `useRootData`. On the server the
// response is cached and replayed on the client (no duplicate request);
// a client-side navigation back to this page re-runs the fetch fresh.
export default definePage(() => {
  const ready = fetch('/api/data').then((r) => r.json() as Promise<Data>);
  return {
    getTitle: () => 'Fetch Data Page',
    getRouteDirective: () => ({ kind: 'ok' }),
    getElements: () => [
      <Root when={ready}>
        <DataDisplay />
      </Root>,
      <Nav />,
    ],
  };
});

function DataDisplay() {
  const data = useRootData<Data>();
  return <div data-testid="fetch-data-name">{data.name}</div>;
}
