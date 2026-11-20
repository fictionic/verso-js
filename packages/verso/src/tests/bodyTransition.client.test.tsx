import {describe, expect, beforeEach, afterEach, vi} from 'vitest';
import {useState, type ReactElement} from 'react';
import {flushSync} from 'react-dom';
import {testWithRLS} from '../userland/testing/rls';
import {initAbort} from '../core/common/abort';
import {ReactRootManager} from '../core/client/roots';
import {BodyElementTransitioner} from '../core/client/transitioners/body';
import {RootContainer} from '../core/common/components/RootContainer';
import {PAGE_ROOT_ELEMENT_ATTR, PAGE_ELEMENT_TOKEN_IDX_ATTR} from '../core/common/constants';

// must run inside the testWithRLS body, because RLS is only live there
function armAbort(): AbortController {
  const ac = new AbortController();
  initAbort(ac.signal);
  return ac;
}

async function mount(manager: ReactRootManager, elements: ReactElement[]) {
  await new BodyElementTransitioner(manager, {reuseDom: false}).transitionElements(elements);
}

async function transition(manager: ReactRootManager, elements: ReactElement[], reuseDom: boolean) {
  await new BodyElementTransitioner(manager, {reuseDom}).transitionElements(elements);
}

const rootNodes = (): HTMLElement[] =>
  Array.from(document.body.querySelectorAll<HTMLElement>(`[${PAGE_ROOT_ELEMENT_ATTR}]`));

function Counter({label}: {label: string}) {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((c) => c + 1)}>{label}:{count}</button>;
}

// mounts a Counter and clicks it once, so its state is 1
async function mountClickedCounter(manager: ReactRootManager) {
  await mount(manager, [<Counter label="A" />]);
  const button = rootNodes()[0]!.querySelector('button')!;
  flushSync(() => button.click());
  expect(button.textContent).toBe('A:1');
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  // the transitioner calls flushSync outside act(), so opt out of the act() warning
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = false;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
      expect(roots[0]).not.toBe(oldNode);
      expect(document.body.contains(oldNode)).toBe(false);
      expect(roots[0]!.textContent).toBe('NEW');
    });

    testWithRLS('a fresh transition to a page with no elements tears down the previous page', async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mount(manager, [<div>OLD</div>]);
      const oldNode = rootNodes()[0]!;

      await transition(manager, [], false);

      expect(rootNodes()).toHaveLength(0);
      expect(document.body.contains(oldNode)).toBe(false);
    });

    testWithRLS('resets React component state', async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mountClickedCounter(manager);

      await transition(manager, [<Counter label="B" />], false);

      expect(rootNodes()[0]!.textContent).toBe('B:0');
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
      expect(after).toBe(node);
      expect(after!.textContent).toBe('B');
    });

    testWithRLS('keeps React component state in a reused root', async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mountClickedCounter(manager);

      await transition(manager, [<Counter label="B" />], true);

      // new props, old state
      expect(rootNodes()[0]!.textContent).toBe('B:1');
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

      expect(document.body.querySelector('#c')).toBe(container);
      expect(container.className).toBe('new');
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
      expect(roots[0]).toBe(node0);
      expect(roots[0]!.textContent).toBe('A2');
      expect(roots[1]).not.toBe(node0);
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
      expect(roots[0]).toBe(node0);
      expect(roots[0]!.textContent).toBe('C');
      expect(document.body.contains(node1!)).toBe(false);
    });

    testWithRLS('kind mismatch: tears down from the mismatch and re-renders fresh', async () => {
      armAbort();
      const manager = new ReactRootManager();
      await mount(manager, [
        <RootContainer id="c">
          <div>INNER</div>
        </RootContainer>,
      ]);
      expect(document.body.querySelector('#c')).not.toBeNull();

      await transition(manager, [<div>ROOT</div>], true);

      expect(document.body.querySelector('#c')).toBeNull();
      const roots = rootNodes();
      expect(roots).toHaveLength(1);
      expect(roots[0]!.textContent).toBe('ROOT');
    });
  });

  describe('abort', () => {
    testWithRLS('an already-aborted signal short-circuits: no DOM mutation', async () => {
      const ac = armAbort();
      const manager = new ReactRootManager();
      ac.abort();

      await transition(manager, [<div>A</div>], false);

      expect(rootNodes()).toHaveLength(0);
    });
  });
});
