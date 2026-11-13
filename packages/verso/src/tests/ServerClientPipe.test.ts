import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createPipe, type PipeSchema } from '../core/common/util/ServerClientPipe';
import { serverSide, clientSide } from '../userland/testing/isomorphic';

const PIPE_NAME = '__testPipe';

interface TestSchema extends PipeSchema {
  data: { req: { method: string; url: string; body: null } };
  fns: { onNumber: [number]; onVoid: [] };
}

const TestPipe = createPipe<TestSchema>(PIPE_NAME);

describe('ServerClientPipe', () => {
  clientSide(() => {
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

        const second = vi.fn();
        TestPipe.reader().onCallFn('onNumber', second);
        expect(second).not.toHaveBeenCalled();

        w.callFn('onNumber', [3]);
        exec();
        expect(second.mock.calls).toEqual([[3]]);
        expect(first.mock.calls).toEqual([[1], [2]]);
      });

      test('calls to different function names are dispatched independently', () => {
        const { w, exec } = makePipeHarness();
        w.init();
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
    describe('Writer script-tag output', () => {
      function capture(use: (w: ReturnType<typeof TestPipe.writer>) => void): string {
        let out = '';
        use(TestPipe.writer((html) => (out += html)));
        return out;
      }

      test('init() emits the reader-bootstrap script for the named pipe', () => {
        const script = capture((w) => w.init());
        expect(script.startsWith('<script>window.__testPipe = {')).toBe(true);
        expect(script.endsWith('};</script>')).toBe(true);
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
        expect(script).toContain('a\\u003cb\\u003ec\\u0026d');
        expect(script).not.toContain('a<b>c&d');
      });
    });

    describe('Environment guard', () => {
      test('reader() throws on the server (no window)', () => {
        // the guard checks `typeof window`, not IS_SERVER
        expect(typeof window).toBe('undefined');
      expect(() => TestPipe.reader()).toThrow(
        /cannot read from ServerClientPipe on the server/,
      );
      });
    });
  });
});
