import { definePage } from '@verso-js/verso';
import { Counter } from '../components/Counter';
import { Nav } from '../components/Nav';

function Boom(): never {
  throw new Error('[fixture] intentional render error from error-root page');
}

export default definePage(() => ({
  getTitle: () => 'Error Root Page',
  getRouteDirective: () => ({ kind: 'ok' }),
  getElements: () => [
    <div data-testid="good-root">
      <h1>Good Root</h1>
      <Counter testid="error-page-counter" />
    </div>,
    <Boom />,
    <Nav />,
  ],
}));
