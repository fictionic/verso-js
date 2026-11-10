import { definePage, fetch, Root } from '@verso-js/verso';
import { Nav } from '../components/Nav';

// A fast root that renders immediately, and a slow root gated on a delayed
// endpoint via `when`. The slow root is written to the stream only after its
// `when` promise settles, so it arrives after the fast root.
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
