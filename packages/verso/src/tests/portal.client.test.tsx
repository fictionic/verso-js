import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ensureRootElement, scheduleRootRender } from '../core/common/components/Root';
import { IsomorphicPortal } from '../userland/components/portal';

// useId() reads the RootContext, so the portal must render inside a Root
function inRoot(element: ReactElement): Promise<ReactElement> {
  return scheduleRootRender(ensureRootElement(element), 0).promise;
}

describe('IsomorphicPortal: client failure branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('throws when selector matches no element', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const element = await inRoot(
      <IsomorphicPortal selector="#does-not-exist">
        <span>child</span>
      </IsomorphicPortal>,
    );
    expect(() => render(element)).toThrow('[verso-portal:client] no target for portal');
  });

  test('warns when source node is missing, but still mounts', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const target = document.createElement('div');
    target.id = 'portal-target';
    document.body.appendChild(target);

    try {
      // render() flushes the effect and the re-render synchronously
      render(await inRoot(
        <IsomorphicPortal selector="#portal-target">
          <span>portal content</span>
        </IsomorphicPortal>,
      ));

      expect(warnSpy).toHaveBeenCalledWith(
        '[verso-portal:client] cannot find server-rendered source node',
      );
      expect(target.textContent).toContain('portal content');
    } finally {
      document.body.removeChild(target);
    }
  });
});
