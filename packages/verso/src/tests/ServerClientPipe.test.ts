import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createPipe, type PipeSchema } from '../core/common/util/ServerClientPipe';
import { serverSide, clientSide } from '../userland/testing/isomorphic';

// These tests drive the REAL createPipe writer() and reader() end-to-end. The
// reader state machine (PIPE_READER_INIT's pending queue, onCallFn replay/clear,
// readValue/replaceValue) is schema-independent, so this uses a local pipe rather
// than the concrete VersoPipe -- the wire format and VersoPipe's specific keys/fns
// are covered elsewhere. The writer's emitted <script> strings are collected, then
// executed against the jsdom `window` exactly as a browser would (the init script
// installs the real PIPE_READER_INIT object on window.__testPipe; value/call scripts
// mutate it). The assertion target is the READER's stateful behavior -- the
// pending-call queue, onCallFn replay/clear, and readValue/replaceValue -- not the
// wire bytes.

const PIPE_NAME = '__testPipe';

interface TestSchema extends PipeSchema {
  data: { req: { method: string; url: string; body: null } };
  fns: { onNumber: [number]; onVoid: [] };
}

const TestPipe = createPipe<TestSchema>(PIPE_NAME);

describe('ServerClientPipe', () => {
  clientSide(() => {
    // Collect writer scripts into a queue; exec() drains and evaluates each
    // one against the global jsdom `window`, undoing the <-style escapes via
    // the JS parser -- the same thing the browser does. Draining lets a test
    // interleave "write some scripts -> exec -> register handler -> write more
    // -> exec".
    function makePipeHarness() {
      const queue: string[] = [];
      const w = TestPipe.writer((html) => queue.push(html));
      const exec = () => {
        while (queue.length) {
          const script = queue.shift()!;
          const js = script.slice('<script>'.length, -'</script>'.length);
          new Function('window', js)(window);
        }
      };
      return { w, exec };
    }

    beforeEach(() => {
      delete (window as any).__testPipe;
    });

    describe('Function call dispatch and buffering (the core)', () => {
      test('a call made after onCallFn registers is delivered with its arguments', () => {
        const { w, exec } = makePipeHarness();
        w.init();
        exec();

        const handler = vi.fn();
        TestPipe.reader().onCallFn('onNumber', handler);

        w.callFn('onNumber', [7]);
        exec();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(7);
      });

      test('multiple calls to the same function are delivered in order', () => {
        const { w, exec } = makePipeHarness();
        w.init();
        exec();

        const handler = vi.fn();
        TestPipe.reader().onCallFn('onNumber', handler);

        w.callFn('onNumber', [1]);
        w.callFn('onNumber', [2]);
        w.callFn('onNumber', [3]);
        exec();

        expect(handler.mock.calls).toEqual([[1], [2], [3]]);
      });

      test('calls made before any handler is registered are buffered and replayed in order', () => {
        const { w, exec } = makePipeHarness();
        w.init();
        w.callFn('onNumber', [1]);
        w.callFn('onNumber', [2]);
        exec();

        // Nothing has consumed the calls yet -- they sit in pending until a handler
        // registers via onCallFn.
        const handler = vi.fn();
        TestPipe.reader().onCallFn('onNumber', handler);

        expect(handler.mock.calls).toEqual([[1], [2]]);
      });

      test('replay clears pending: a second onCallFn does not re-deliver the buffered calls', () => {
        const { w, exec } = makePipeHarness();
        w.init();
        w.callFn('onNumber', [1]);
        w.callFn('onNumber', [2]);
        exec();

        const first = vi.fn();
        TestPipe.reader().onCallFn('onNumber', first);
        expect(first.mock.calls).toEqual([[1], [2]]);

        // Registering again must NOT replay the already-drained pending calls.
        const second = vi.fn();
        TestPipe.reader().onCallFn('onNumber', second);
        expect(second).not.toHaveBeenCalled();

        // Only a call arriving after the second registration reaches it.
        w.callFn('onNumber', [3]);
        exec();
        expect(second.mock.calls).toEqual([[3]]);
        expect(first.mock.calls).toEqual([[1], [2]]);
      });

      test('calls to different function names are dispatched independently', () => {
        const { w, exec } = makePipeHarness();
        w.init();
        // A call to a different fn buffered before its handler registers must never
        // leak into another fn's handler.
        w.callFn('onVoid', []);
        w.callFn('onNumber', [5]);
        exec();

        const hydrate = vi.fn();
        TestPipe.reader().onCallFn('onNumber', hydrate);
        expect(hydrate.mock.calls).toEqual([[5]]);

        const abort = vi.fn();
        TestPipe.reader().onCallFn('onVoid', abort);
        expect(abort).toHaveBeenCalledTimes(1);
        expect(abort).toHaveBeenCalledWith();

        // The hydrate handler never saw the abort call.
        expect(hydrate.mock.calls).toEqual([[5]]);
      });
    });

    describe('Data round-trip through the real reader', () => {
      test('writeValue then real readValue returns the value identically', () => {
        const { w, exec } = makePipeHarness();
        const value = { method: 'GET', url: '/page', body: null };
        w.init();
        w.writeValue('req', value);
        exec();

        expect(TestPipe.reader().readValue('req')).toEqual(value);
      });

      test('a value with HTML-sensitive characters survives to the real reader', () => {
        const { w, exec } = makePipeHarness();
        const value = {
          method: 'GET',
          url: '/search?q=</script><tag>&amp;',
            body: null,
        };
        w.init();
        w.writeValue('req', value);
        exec();

        // The writer escapes < > & as < > &; the browser undoes them
        // when it executes the script, so the reader sees the original string.
        expect(TestPipe.reader().readValue('req')).toEqual(value);
      });

      test('replaceValue overwrites a key as seen by a later readValue', () => {
        const { w, exec } = makePipeHarness();
        w.init();
        w.writeValue('req', { method: 'GET', url: '/a', body: null });
        exec();

        const reader = TestPipe.reader();
        const next = { method: 'POST', url: '/b', body: null };
        reader.replaceValue('req', next);

        expect(reader.readValue('req')).toEqual(next);
      });
    });
  });

  serverSide(() => {
    // Writer output is produced server-side during SSR; assert the emitted strings.
    describe('Writer script-tag output', () => {
      // Capture the single <script> string a writer call emits.
      function capture(use: (w: ReturnType<typeof TestPipe.writer>) => void): string {
        let out = '';
        use(TestPipe.writer((html) => (out += html)));
        return out;
      }

      test('init() emits the reader-bootstrap script for the named pipe', () => {
        const script = capture((w) => w.init());
        expect(script.startsWith('<script>window.__testPipe = {')).toBe(true);
        expect(script.endsWith('};</script>')).toBe(true);
        // The installed object carries the call() dispatcher the reader relies on.
        expect(script).toContain('call(name, args)');
      });

      test('writeValue() emits a data assignment with JSON-serialized value', () => {
        const script = capture((w) =>
          w.writeValue('req', { method: 'GET', url: '/a', body: null }),
        );
        expect(script).toBe(
          `<script>window.__testPipe.data['req'] = {"method":"GET","url":"/a","body":null}</script>`,
        );
      });

      test('callFn() emits a fns.call with the function name and serialized args', () => {
        const script = capture((w) => w.callFn('onNumber', [7]));
        expect(script).toBe(
          `<script>window.__testPipe.fns.call('onNumber', [7])</script>`,
        );
      });

      test('writeValue() escapes HTML-sensitive characters in the value', () => {
        const script = capture((w) =>
          w.writeValue('req', { method: 'GET', url: 'a<b>c&d', body: null }),
        );
        // < > & are emitted as their \u escapes so the value can't break out of the
        // script context; the raw characters never appear in the assignment.
        expect(script).toContain('a\\u003cb\\u003ec\\u0026d');
        expect(script).not.toContain('a<b>c&d');
      });
    });

    describe('Environment guard', () => {
      test('reader() throws on the server (no window)', () => {
        // The guard branches on the runtime `typeof window`, not IS_SERVER, so the
        // throw is only reachable where window is genuinely undefined. Assert that
        // precondition first so the test fails loudly (rather than silently passing)
        // if jsdom globals ever leak into the node pass.
        expect(typeof window).toBe('undefined');
      expect(() => TestPipe.reader()).toThrow(
        /cannot read from ServerClientPipe on the server/,
      );
      });
    });
  });
});
