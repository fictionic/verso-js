import { definePage, navigateTo } from '@verso-js/verso';
import { Counter } from '../components/Counter';
import { Nav } from '../components/Nav';

// One root, a title, static content, plus a Counter to prove hydration.
// The navigateTo button is the programmatic-navigation entry point for suite 19.
export default definePage(() => ({
  getTitle: () => 'Basic Page',
  getRouteDirective: () => ({ kind: 'ok' }),
  getElements: () => [
    <div>
      <h1 data-testid="basic-heading">Basic Page</h1>
      <p>Static content rendered on the server.</p>
      <Counter testid="basic-counter" />
      <button data-testid="basic-navigate-to" onClick={() => void navigateTo('/nav-target')}>
        navigateTo nav-target
      </button>
      <Nav />
    </div>,
  ],
}));
