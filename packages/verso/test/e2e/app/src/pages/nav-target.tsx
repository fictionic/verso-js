import { definePage } from '@verso-js/verso';
import { Counter } from '../components/Counter';
import { Nav } from '../components/Nav';

// A simple destination for navigation tests.
export default definePage(() => ({
  getTitle: () => 'Nav Target Page',
  getRouteDirective: () => ({ kind: 'ok' }),
  getElements: () => [
    <div>
      <h1 data-testid="nav-target-heading">Nav Target</h1>
      <Counter testid="nav-target-counter" />
      <Nav />
    </div>,
  ],
}));
