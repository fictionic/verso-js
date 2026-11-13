import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest';
import { ClientNavigationManager, type StartNavigation } from '../core/client/navigation';
import { Resolver, type RouteResolution } from '../core/common/resolver';
import type { AnyStandardizedHandler } from '../core/common/handler/RouteHandler';
import { silenced } from '../util/promise';

// the manager only reads handler.type
function makeResolution(routeName = 'home'): RouteResolution {
  return {
    kind: 'response',
    routeName,
    statusCode: 200,
    handler: { type: 'page' } as AnyStandardizedHandler,
  };
}

function makeStart(
  url = 'http://localhost/',
  onSignal?: (s: AbortSignal) => void,
): StartNavigation {
  return (signal) => {
    onSignal?.(signal);
    return new Request(url, { signal });
  };
}

describe('ClientNavigationManager', () => {

  let manager: ClientNavigationManager;
  let resolveRoute: Mock<Resolver['resolveRoute']>;

  beforeEach(async () => {
    resolveRoute = vi.fn<Resolver['resolveRoute']>();
    const resolver = {
      resolveRoute,
    } as unknown as Resolver;
    manager = new ClientNavigationManager(resolver);
    resolveRoute.mockResolvedValueOnce(makeResolution());
    await manager.requestNavigation(makeStart(), vi.fn(async () => {}));
    resolveRoute.mockClear();
  });

  describe('a single navigation', () => {
    test('sets pending state with the requested url while resolution is in flight', async () => {
      resolveRoute.mockReturnValueOnce(new Promise<RouteResolution>(() => {}));
      const nav = manager.requestNavigation(makeStart('http://localhost/slow'), vi.fn(async () => {}));

      // setPending runs before requestNavigation yields
      const state = manager.getState();
      expect(state.status).toBe('pending');
      if (state.status === 'pending') {
        expect(state.requestedUrl).toBe('http://localhost/slow');
      }

      void nav;
    });

    test('commits and goes idle with the resolved route', async () => {
      resolveRoute.mockResolvedValueOnce(makeResolution('page-a'));
      const commit = vi.fn(async () => {});
      await manager.requestNavigation(makeStart('http://localhost/a'), commit);

      expect(commit).toHaveBeenCalledTimes(1);
      const state = manager.getState();
      expect(state.status).toBe('idle');
      if (state.status === 'idle') {
        expect(state.routeName).toBe('page-a');
        expect(state.location).toBe('http://localhost/a');
      }
    });

    test('waitForNextIdle resolves once the navigation settles', async () => {
      const next = window.__versoNavigation.waitForNextIdle();

      resolveRoute.mockResolvedValueOnce(makeResolution('page-a'));
      await manager.requestNavigation(makeStart(), vi.fn(async () => {}));

      await expect(next).resolves.toBeUndefined();
    });
  });

  describe('getPageResolution', () => {
    test('follows a same-origin redirect to the redirected route', async () => {
      // same-origin is relative to the jsdom location
      const redirectLocation = new URL('/new', window.location.origin).href;
      resolveRoute
        .mockResolvedValueOnce({ kind: 'response', routeName: 'old', statusCode: 302, redirectLocation })
        .mockResolvedValueOnce(makeResolution('new'));
      const commit = vi.fn(async () => {});
      await manager.requestNavigation(makeStart('http://localhost/old'), commit);

      expect(resolveRoute).toHaveBeenCalledTimes(2);
      expect(commit).toHaveBeenCalledTimes(1);
      const state = manager.getState();
      expect(state.status).toBe('idle');
      if (state.status === 'idle') {
        expect(state.routeName).toBe('new');
        expect(state.location).toBe(redirectLocation);
      }
    });

    test('rejects when the resolution is not a response', async () => {
      resolveRoute.mockResolvedValueOnce({ kind: 'not-found' });
      const commit = vi.fn(async () => {});
      await expect(
        manager.requestNavigation(makeStart(), commit),
      ).rejects.toThrow('resolution failed');
      expect(commit).not.toHaveBeenCalled();
    });

    test('rejects a response with no handler', async () => {
      resolveRoute.mockResolvedValueOnce({ kind: 'response', routeName: 'x', statusCode: 200 });
      await expect(
        manager.requestNavigation(makeStart(), vi.fn(async () => {})),
      ).rejects.toThrow('no page handler');
    });

    test('rejects a non-page handler', async () => {
      resolveRoute.mockResolvedValueOnce({
        kind: 'response',
        routeName: 'x',
        statusCode: 200,
        handler: { type: 'endpoint' } as AnyStandardizedHandler,
      });
      await expect(
        manager.requestNavigation(makeStart(), vi.fn(async () => {})),
      ).rejects.toThrow('only supports page handlers');
    });

    test('propagates a genuine resolver error', async () => {
      resolveRoute.mockRejectedValueOnce(new Error('boom'));
      await expect(
        manager.requestNavigation(makeStart(), vi.fn(async () => {})),
      ).rejects.toThrow('boom');
    });
  });

  describe('supersession', () => {
    test('the superseded navigation does not commit or go idle; the winner does', async () => {
      const commitA = vi.fn(async () => {});
      const commitB = vi.fn(async () => {});

      resolveRoute.mockReturnValueOnce(new Promise<RouteResolution>(() => {}));
      resolveRoute.mockResolvedValueOnce(makeResolution('page-b'));

      const navA = manager.requestNavigation(makeStart(), commitA);
      const navB = manager.requestNavigation(makeStart(), commitB);

      await navB;
      await navA;

      expect(commitA).not.toHaveBeenCalled();
      expect(commitB).toHaveBeenCalledTimes(1);
      const state = manager.getState();
      expect(state.status).toBe('idle');
      if (state.status === 'idle') {
        expect(state.routeName).toBe('page-b');
      }
    });

    test('requestNavigation for the superseded navigation resolves rather than rejects', async () => {
      resolveRoute.mockReturnValueOnce(new Promise<RouteResolution>(() => {}));
      resolveRoute.mockResolvedValueOnce(makeResolution());

      const navA = manager.requestNavigation(makeStart(), vi.fn(async () => {}));
      const navB = manager.requestNavigation(makeStart(), vi.fn(async () => {}));

      await navB;
      await expect(navA).resolves.toBeUndefined();
    });

    test('the superseded navigation has its AbortSignal aborted synchronously', async () => {
      let signalA: AbortSignal | undefined;
      const startA = makeStart('http://localhost/', (s) => { signalA = s; });

      resolveRoute.mockReturnValueOnce(new Promise<RouteResolution>(() => {}));
      resolveRoute.mockResolvedValueOnce(makeResolution());

      const navA = manager.requestNavigation(startA, vi.fn(async () => {}));
      expect(signalA).toBeDefined();
      expect(signalA!.aborted).toBe(false);

      const navB = manager.requestNavigation(makeStart(), vi.fn(async () => {}));
      expect(signalA!.aborted).toBe(true);

      await navB;
      await silenced(navA);
    });
  });

});
