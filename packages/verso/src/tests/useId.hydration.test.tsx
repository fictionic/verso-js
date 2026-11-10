import React from 'react';
import { testHydration } from '../userland/testing/hydration';
import { useId } from '../userland/hooks/useId';
import {
  makeRootComponent,
  scheduleRootRender,
  type AnyRootElement,
} from '../core/common/components/Root';

// Renders its useId() into the DOM as text so any divergence between the server
// render and the client hydration surfaces as a hydration mismatch. This is the
// regression guard for the original bug: a call-order counter double-counted
// under StrictMode's double render on the client and diverged from the server.
// React's useId is position-derived, so it stays stable across both.
function Probe() {
  return <div>{useId()}</div>;
}

// scheduleRootRender wraps the element in <StrictMode> (so hydration double-
// renders on the client) and supplies the RootContext useId() reads.
const MyRoot = makeRootComponent<object>(() => <Probe />, () => ({}));
const rootElement = await scheduleRootRender(
  React.createElement(MyRoot) as AnyRootElement,
  0,
).promise;

testHydration('useId is stable across server render and StrictMode hydration', () => rootElement);
