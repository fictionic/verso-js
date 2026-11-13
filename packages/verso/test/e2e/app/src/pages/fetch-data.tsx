import { definePage, fetch, Root, useRootData } from '@verso-js/verso';
import { Nav } from '../components/Nav';

type Data = { name: string; id: number };

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
