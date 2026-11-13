import { expect, test } from 'vitest';
import {
  HydrationMismatchError,
  testHydration,
  throwIfHydrationMismatch,
} from '../userland/testing/hydration';

// A component that reads IS_SERVER but renders the same content in both phases
// hydrates cleanly. (A component whose output depends on IS_SERVER would fail —
// that's what testHydration guards against.)
function Greeting({ name }: { name: string }) {
  const where = IS_SERVER ? 'server' : 'client';
  return (
    <section>
      <h1>Hello, {name}</h1>
      {/* same regardless of `where`, so no mismatch */}
      <p data-rendered-on={where ? 'somewhere' : 'nowhere'}>welcome</p>
    </section>
  );
}

testHydration('component with isomorphic output hydrates cleanly', () => (
  <Greeting name="world" />
));

// A component whose text depends on IS_SERVER renders differently in the two
// phases, so hydration must report a mismatch.
function Mismatch() {
  return <p>{IS_SERVER ? 'server' : 'client'}</p>;
}

// testHydration() registers its own test, so assert on
// throwIfHydrationMismatch() (its body) to prove that a mismatch fails.
test('a mismatch between server and client output fails', async () => {
  await expect(throwIfHydrationMismatch(() => <Mismatch />)).rejects.toThrow(
    HydrationMismatchError,
  );
});
