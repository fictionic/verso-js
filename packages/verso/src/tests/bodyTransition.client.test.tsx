// Suite: BodyElementTransitioner (client navigation body swap).
//
// Exercises the `navigate()` body-transition seam directly, without going
// through ClientController (which would drag in the resolver, nav manager, and
// header/style/script transitioners — none of which is the body swap). We drive
// the transitioner against a real jsdom `<body>` with REAL ReactDOM: the unit's
// observable contract is *what the DOM becomes* and *whether a node is reused or
// recreated*, so we assert on node identity + content, not on internal calls.
//
// Setup mirrors production: a page is "already mounted" by running one fresh
// transition, then the transition under test runs with a NEW transitioner over
// the SAME persistent ReactRootManager — exactly how navigate() reuses the
// manager across navigations (controller.ts). The transitioner reads the abort
// signal from RLS (abort.ts -> getAbortSignal), so each test arms it via
// initAbort inside the testWithRLS body (RLS is only live there).

import {describe, expect, beforeEach, afterEach, vi} from 'vitest';
import type {ReactElement} from 'react';
import {testWithRLS} from '../userland/testing/rls';
import {initAbort} from '../core/common/abort';
import {ReactRootManager} from '../core/client/roots';
import {BodyElementTransitioner} from '../core/client/transitioners/body';
import {RootContainer} from '../core/common/components/RootContainer';
import {PAGE_ROOT_ELEMENT_ATTR, PAGE_ELEMENT_TOKEN_IDX_ATTR} from '../core/common/constants';

// --- Harness -----------------------------------------------------------------

// Must run inside the testWithRLS body: RLS (and thus the abort signal the
// transitioner reads) is only live there. Returns the controller so the abort
// test can trip it.
function armAbort(): AbortController {
  const ac = new AbortController();
  initAbort(ac.signal);
  return ac;
}

// Establish the currently-mounted page (fresh path plants attributed DOM +
// registers real React roots in the manager).
async function mount(manager: ReactRootManager, elements: ReactElement[]) {
  await new BodyElementTransitioner(manager, {reuseDom: false}).transitionElements(elements);
}

// Run a navigation body swap — a new transitioner over the same manager.
async function transition(manager: ReactRootManager, elements: ReactElement[], reuseDom: boolean) {
  await new BodyElementTransitioner(manager, {reuseDom}).transitionElements(elements);
}

// Root nodes only (containers carry a token-idx attr but not the root sentinel).
const rootNodes = (): HTMLElement[] =>
  Array.from(document.body.querySelectorAll<HTMLElement>(`[${PAGE_ROOT_ELEMENT_ATTR}]`));

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  // driving real ReactDOM with flushSync outside a test renderer — opt out of
  // the act() environment so React doesn't warn about it.
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = false;
  // the transitioner is intentionally chatty on bail-out paths; keep it quiet.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests -------------------------------------------------------------------

describe('BodyElementTransitioner', () => {
  describe('fresh path (reuseDom: false)', () => {
    testWithRLS('renders roots into the body in document order', async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mount(manager, [<div>A</div>, <div>B</div>]);
      expect(rootNodes().map((n) => n.textContent)).toEqual(['A', 'B']);
    });

    testWithRLS("wraps a RootContainer's children in a div carrying its props", async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mount(manager, [
        <RootContainer id="c" className="wrap">
          <div>INNER</div>
        </RootContainer>,
      ]);
      const container = document.body.querySelector('div#c.wrap');
      expect(container).not.toBeNull();
      expect(container!.querySelector(`[${PAGE_ROOT_ELEMENT_ATTR}]`)?.textContent).toBe('INNER');
    });

    testWithRLS('a fresh transition tears down the previous page and renders anew', async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mount(manager, [<div>OLD</div>]);
      const oldNode = rootNodes()[0]!;

      await transition(manager, [<div>NEW</div>], false);

      const roots = rootNodes();
      expect(roots).toHaveLength(1);
      expect(roots[0]).not.toBe(oldNode); // recreated, not reused
      expect(document.body.contains(oldNode)).toBe(false); // old node removed
      expect(roots[0]!.textContent).toBe('NEW');
    });
  });

  describe('reuse path (reuseDom: true), matching shape', () => {
    testWithRLS('reuses the existing DOM node and reconciles new content in place', async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mount(manager, [<div>A</div>]);
      const node = rootNodes()[0];

      await transition(manager, [<div>B</div>], true);

      const after = rootNodes()[0];
      expect(after).toBe(node); // same node instance kept
      expect(after!.textContent).toBe('B'); // content reconciled by React
    });

    testWithRLS('updates a reused container\'s attrs in place', async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mount(manager, [
        <RootContainer id="c" className="old">
          <div>X</div>
        </RootContainer>,
      ]);
      const container = document.body.querySelector('#c') as HTMLElement;

      await transition(
        manager,
        [
          <RootContainer id="c" className="new">
            <div>X</div>
          </RootContainer>,
        ],
        true,
      );

      expect(document.body.querySelector('#c')).toBe(container); // reused
      expect(container.className).toBe('new'); // attrs refreshed
    });
  });

  describe('reuse path bail-out cascade', () => {
    testWithRLS('new page has more elements: prefix reused, extra appended fresh', async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mount(manager, [<div>A</div>]);
      const node0 = rootNodes()[0];

      await transition(manager, [<div>A2</div>, <div>B2</div>], true);

      const roots = rootNodes();
      expect(roots).toHaveLength(2);
      expect(roots[0]).toBe(node0); // reused
      expect(roots[0]!.textContent).toBe('A2');
      expect(roots[1]).not.toBe(node0); // freshly appended
      expect(roots[1]!.textContent).toBe('B2');
    });

    testWithRLS('new page has fewer elements: trailing old nodes are cleared', async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mount(manager, [<div>A</div>, <div>B</div>]);
      const [node0, node1] = rootNodes();

      await transition(manager, [<div>C</div>], true);

      const roots = rootNodes();
      expect(roots).toHaveLength(1);
      expect(roots[0]).toBe(node0); // reused
      expect(roots[0]!.textContent).toBe('C');
      expect(document.body.contains(node1!)).toBe(false); // trailing leftover removed
    });

    testWithRLS('kind mismatch: tears down from the mismatch and re-renders fresh', async () => {
      armAbort();
      const manager = new ReactRootManager();
      // index 0 is a container...
      await mount(manager, [
        <RootContainer id="c">
          <div>INNER</div>
        </RootContainer>,
      ]);
      expect(document.body.querySelector('#c')).not.toBeNull();

      // ...but the new page has a root at index 0 -> shape mismatch -> bail
      await transition(manager, [<div>ROOT</div>], true);

      expect(document.body.querySelector('#c')).toBeNull(); // old container torn down
      const roots = rootNodes();
      expect(roots).toHaveLength(1);
      expect(roots[0]!.textContent).toBe('ROOT');
    });
  });

  describe('abort', () => {
    testWithRLS('an already-aborted signal short-circuits: no DOM mutation', async () => {
      const ac = armAbort();
      const manager = new ReactRootManager();
      ac.abort(); // a newer navigation is about to run

      await transition(manager, [<div>A</div>], false);

      expect(rootNodes()).toHaveLength(0);
    });
  });
});
