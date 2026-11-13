import { definePage, fetch, Root } from '@verso-js/verso';
import { Nav } from '../components/Nav';

export default definePage(() => {
  const slow = fetch('/api/delay?ms=500').then((r) => r.json());
  return {
    getTitle: () => 'Slow Root Page',
    getRouteDirective: () => ({ kind: 'ok' }),
    getElements: () => [
      <div data-testid="fast-root">
        <h1>Fast Root</h1>
      </div>,
      <Root when={slow}>
        <div data-testid="slow-root">
          <h1>Slow Root</h1>
        </div>
      </Root>,
      <Nav />,
    ],
  };
});
