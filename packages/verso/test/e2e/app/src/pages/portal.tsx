import { definePage, IsomorphicPortal, Root, RootContainer } from '@verso-js/verso';
import { Nav } from '../components/Nav';

// the target must come first, so it exists when the relocation script runs
export default definePage(() => ({
  getTitle: () => 'Portal Page',
  getRouteDirective: () => ({ kind: 'ok' }),
  getElements: () => [
    <RootContainer id="portal-target" />,
    <Root>
      <IsomorphicPortal selector="#portal-target">
        <div data-testid="portal-content">Portal content</div>
      </IsomorphicPortal>
    </Root>,
    <Nav />,
  ],
}));
