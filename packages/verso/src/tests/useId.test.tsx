import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, test, expect } from 'vitest';
import { useId } from '../userland/hooks/useId';
import {
  makeRootComponent,
  scheduleRootRender,
  type AnyRootElement,
} from '../core/common/components/Root';

// Render a root at `index` whose probe calls useId() twice, and return the two
// ids it produced. scheduleRootRender supplies the RootContext (carrying the
// root index) that useId() reads, so this exercises useId through the same path
// the framework renders roots.
async function idsFromRoot(index: number): Promise<[string, string]> {
  const ids: string[] = [];
  const Probe: React.FC = () => {
    ids.push(useId(), useId());
    return null;
  };
  const MyRoot = makeRootComponent<object>(() => <Probe />, () => ({}));
  const element = React.createElement(MyRoot) as AnyRootElement;
  const rendered = await scheduleRootRender(element, index).promise;
  renderToString(rendered);
  return [ids[0]!, ids[1]!];
}

describe('useId', () => {
  test('distinct calls within one root return distinct ids', async () => {
    const [a, b] = await idsFromRoot(0);
    expect(a).not.toBe(b);
  });

  test('ids are namespaced by the root index', async () => {
    const [a, b] = await idsFromRoot(3);
    expect(a.startsWith('3:')).toBe(true);
    expect(b.startsWith('3:')).toBe(true);
  });

  test('same tree positions in different roots do not collide', async () => {
    const first = await idsFromRoot(1);
    const second = await idsFromRoot(4);
    // React's useId gives the same intra-root suffix at the same position, so
    // the root-index namespace is what keeps the two roots from colliding.
    expect(first).not.toContain(second[0]);
    expect(first).not.toContain(second[1]);
    expect(first.every((id) => id.startsWith('1:'))).toBe(true);
    expect(second.every((id) => id.startsWith('4:'))).toBe(true);
  });
});
