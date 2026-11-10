import { definePage, IsomorphicPortal, Root, RootContainer } from '@verso-js/verso';
import { Nav } from '../components/Nav';

// The portal target is a structural RootContainer (a plain `<div id="portal-target">`
// that React does not hydrate), rendered *first* so it exists in the DOM by the time
// the parser reaches the portal's inline relocation script. The portal itself lives in
// a later root and targets `#portal-target` by selector.
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
