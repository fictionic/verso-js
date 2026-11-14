import { expect, test } from 'vitest';
import {
  HydrationMismatchError,
  testHydration,
  throwIfHydrationMismatch,
} from '../userland/testing/hydration';

function Greeting({ name }: { name: string }) {
  return (
    <section>
      <h1>Hello, {name}</h1>
      <p>welcome</p>
    </section>
  );
}

testHydration('component with isomorphic output hydrates cleanly', () => (
  <Greeting name="world" />
));

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
