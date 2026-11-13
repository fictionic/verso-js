import { test } from 'vitest';
import type { ReactElement } from 'react';
import { getPass } from './pass';

/**
 * Registers a test that fails if the server render of `render()` does not
 * hydrate cleanly on the client. `render` is called once per phase.
 */
export function testHydration(desc: string, render: () => ReactElement): void {
  if (getPass() !== 'hydration') {
    return;
  }
  test(desc, () => throwIfHydrationMismatch(render));
}

export class HydrationMismatchError extends Error {
  readonly mismatches: Error[];

  constructor(mismatches: Error[]) {
    super(
      `hydration mismatch(es):\n` +
        mismatches.map((e) => `  - ${e.message}`).join('\n'),
    );
    this.name = 'HydrationMismatchError';
    this.mismatches = mismatches;
  }
}

export async function throwIfHydrationMismatch(render: () => ReactElement): Promise<void> {
  const { renderToString } = await import('react-dom/server');
  const { hydrateRoot } = await import('react-dom/client');
  const { act } = await import('react');

  globalThis.IS_SERVER = true;
  const html = renderToString(render());

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);

  globalThis.IS_SERVER = false;
  const mismatches: Error[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, render(), {
      onRecoverableError: (error) => mismatches.push(error as Error),
    });
  });
  await act(async () => {
    root.unmount();
  });
  container.remove();

  if (mismatches.length > 0) {
    throw new HydrationMismatchError(mismatches);
  }
}
