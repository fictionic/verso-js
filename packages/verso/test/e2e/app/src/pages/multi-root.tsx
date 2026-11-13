import { definePage } from '@verso-js/verso';
import { Nav } from '../components/Nav';

export default definePage(() => ({
  getTitle: () => 'Multi Root Page',
  getRouteDirective: () => ({ kind: 'ok' }),
  getElements: () => [
    <div data-testid="root-one">
      <h1>Root One</h1>
    </div>,
    <div data-testid="root-two">
      <h1>Root Two</h1>
    </div>,
    <Nav />,
  ],
}));
