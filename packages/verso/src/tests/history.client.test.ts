import { describe, test, expect, vi, beforeEach } from 'vitest';
import { HistoryManager, VERSO_HISTORY_FRAME_KEY } from '../core/client/history';

// Drain the microtask queue — several rounds because chained awaits need a few ticks.
async function tick() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('HistoryManager', () => {

  beforeEach(() => {
    history.replaceState(null, '');
  });

  test('stampHistoryFrame merges into an existing object state', () => {
    history.replaceState({ myKey: 'myValue' }, '');
    const manager = new HistoryManager(vi.fn());
    manager.stampHistoryFrame({ reuseDom: false });

    const state = window.history.state;
    expect(state.myKey).toBe('myValue');
    expect(state[VERSO_HISTORY_FRAME_KEY]).toBeDefined();
    expect(state[VERSO_HISTORY_FRAME_KEY].options.reuseDom).toBe(false);
  });

  test('stampHistoryFrame clobbers non-object state', () => {
    // history.state is already null from beforeEach
    const manager = new HistoryManager(vi.fn());
    manager.stampHistoryFrame({ reuseDom: true });

    const state = window.history.state;
    expect(state[VERSO_HISTORY_FRAME_KEY]).toBeDefined();
    expect(state[VERSO_HISTORY_FRAME_KEY].options.reuseDom).toBe(true);
  });

  test('pushFrame stamps reuseDom: true and pushes the url', () => {
    const manager = new HistoryManager(vi.fn());
    manager.pushFrame('/new-page');

    expect(window.history.state[VERSO_HISTORY_FRAME_KEY].options.reuseDom).toBe(true);
    expect(window.location.pathname).toBe('/new-page');
  });

  test('getNavigateOptions returns options for a verso frame', () => {
    const manager = new HistoryManager(vi.fn());
    manager.stampHistoryFrame({ reuseDom: true });

    const opts = manager.getNavigateOptions();
    expect(opts).not.toBeNull();
    expect(opts!.reuseDom).toBe(true);
  });

  test('getNavigateOptions returns null for a foreign (non-verso) state', () => {
    history.replaceState({ someOtherApp: true }, '');
    const manager = new HistoryManager(vi.fn());

    expect(manager.getNavigateOptions()).toBeNull();
  });

  test('onPopState ignores foreign frames', async () => {
    const onPop = vi.fn();
    const manager = new HistoryManager(onPop);
    manager.installListener();

    window.dispatchEvent(new PopStateEvent('popstate', { state: { notVerso: true } }));
    await tick();

    expect(onPop).not.toHaveBeenCalled();
  });

  test('onPopState fires for a verso frame', async () => {
    const onPop = vi.fn(async () => {});
    const manager = new HistoryManager(onPop);
    manager.installListener();

    const versoState = { [VERSO_HISTORY_FRAME_KEY]: { options: { reuseDom: false } } };
    window.dispatchEvent(new PopStateEvent('popstate', { state: versoState }));
    await tick();

    expect(onPop).toHaveBeenCalledTimes(1);
    expect(onPop).toHaveBeenCalledWith(expect.stringMatching(/^\//), { reuseDom: false });
  });

  test('installListener wires the popstate event to onPopToVersoState', async () => {
    const onPop = vi.fn(async () => {});
    const manager = new HistoryManager(onPop);
    manager.installListener();

    const versoState = { [VERSO_HISTORY_FRAME_KEY]: { options: { reuseDom: true } } };
    window.dispatchEvent(new PopStateEvent('popstate', { state: versoState }));
    await tick();

    expect(onPop).toHaveBeenCalledTimes(1);
  });

});
