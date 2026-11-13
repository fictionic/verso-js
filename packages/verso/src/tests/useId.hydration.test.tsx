import React from 'react';
import { testHydration } from '../userland/testing/hydration';
import { useId } from '../userland/hooks/useId';
import {
  makeRootComponent,
  scheduleRootRender,
  type AnyRootElement,
} from '../core/common/components/Root';

// regression: an older call-order counter diverged under the StrictMode double
// render on the client
function Probe() {
  return <div>{useId()}</div>;
}

// scheduleRootRender wraps the element in <StrictMode>
const MyRoot = makeRootComponent<object>(() => <Probe />, () => ({}));
const rootElement = await scheduleRootRender(
  React.createElement(MyRoot) as AnyRootElement,
  0,
).promise;

testHydration('useId is stable across server render and StrictMode hydration', () => rootElement);
