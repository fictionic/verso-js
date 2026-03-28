// @vitest-environment jsdom
import { test, expect, describe, beforeEach } from 'vitest';
import { createPipe } from '@/verso/util/ServerClientPipe';

const PIPE_NAME = 'test';

function simulatePipe() {
  const chunks: string[] = [];
  function flush() {
    for (const chunk of chunks) {
      // simulate the browser auto-evaluating scripts on load
      const match = chunk.match(/<script>([\s\S]*?)<\/script>/);
      if (match) new Function(match[1]!).call(window);
    }
    chunks.length = 0;
  }
  const write = (html: string) => chunks.push(html);

  const pipe = createPipe(PIPE_NAME);
  const writer = pipe.writer(write);
  // Flush the init script before creating the reader, mirroring real usage
  // where the inline init script runs before the client bundle loads.
  flush();
  const reader = pipe.reader();

  return { reader, writer, chunks, flush };
}

describe('VersoPipe', () => {
  beforeEach(() => {
    delete (window as any)[PIPE_NAME];
  });

  describe('writer', () => {
    test('init script creates pipe on window', () => {
      const { reader } = simulatePipe();
      expect(reader._impl).toBeDefined();
      expect(reader._impl.data).toEqual({});
      expect(reader._impl.fns.pending).toEqual({});
      expect(reader._impl.fns.handlers).toEqual({});
      expect(typeof reader._impl.fns.call).toBe('function');
    });

    test('writeValue sets data on pipe', () => {
      const { writer, flush, reader } = simulatePipe();
      writer.writeValue('myKey', { hello: 'world' });
      flush();
      expect(reader._impl.data.myKey).toEqual({ hello: 'world' });
    });

    test('writeValue escapes HTML-sensitive characters', () => {
      const { writer, chunks, flush, reader } = simulatePipe();
      writer.writeValue('xss', '<script>alert(1)</script>');
      // Check the raw output contains escaped sequences
      expect(chunks[0]).not.toContain('<script>alert');
      expect(chunks[0]).toContain('\\u003c');
      // But after eval, the value is unescaped
      flush();
      expect(reader._impl.data.xss).toBe('<script>alert(1)</script>');
    });

    test('callFn buffers when no handler is installed', () => {
      const { writer, flush, reader } = simulatePipe();
      writer.callFn('rootArrival', [0, 3]);
      writer.callFn('rootArrival', [4, 5]);
      flush();
      expect(reader._impl.fns.pending.rootArrival).toEqual([[0, 3], [4, 5]]);
    });

    test('callFn invokes handler directly when one is installed', () => {
      const { writer, flush, reader } = simulatePipe();
      const calls: unknown[][] = [];
      reader._impl.fns.handlers.dataArrival = (...args: unknown[]) => calls.push(args);
      writer.callFn('dataArrival', ['/api/foo', { data: 1 }]);
      flush();
      expect(calls).toEqual([['/api/foo', { data: 1 }]]);
      expect(reader._impl.fns.pending.dataArrival).toBeUndefined();
    });
  });

  describe('reader', () => {
    test('readValue returns written data', () => {
      const { writer, reader, flush } = simulatePipe();
      writer.writeValue('key', 42);
      flush();
      expect(reader.readValue('key')).toBe(42);
    });

    test('replaceValue overwrites data', () => {
      const { writer, reader, flush } = simulatePipe();
      writer.writeValue('key', 'old');
      flush();
      reader.replaceValue('key', 'new');
      expect(reader.readValue('key')).toBe('new');
    });

    test('onCallFn replays buffered calls', () => {
      const { writer, reader, flush } = simulatePipe();
      writer.callFn('rootArrival', [0, 3]);
      writer.callFn('rootArrival', [4, 5]);
      flush();

      const calls: unknown[][] = [];
      reader.onCallFn('rootArrival', (...args) => calls.push(args));
      expect(calls).toEqual([[0, 3], [4, 5]]);
    });

    test('onCallFn clears pending buffer after replay', () => {
      const { writer, reader, flush } = simulatePipe();
      writer.callFn('rootArrival', [0, 1]);
      flush();

      reader.onCallFn('rootArrival', () => {});
      expect(reader._impl.fns.pending.rootArrival).toBeUndefined();
    });

    test('onCallFn installs handler for future calls', () => {
      const { writer, reader, flush } = simulatePipe();

      const calls: unknown[][] = [];
      reader.onCallFn('rootArrival', (...args) => calls.push(args));

      // Simulate a later server-streamed call
      writer.callFn('rootArrival', [6, 7]);
      flush();

      expect(calls).toEqual([[6, 7]]);
    });

    test('onCallFn handles multiple function names independently', () => {
      const { writer, reader, flush } = simulatePipe();
      writer.callFn('rootArrival', [0, 1]);
      writer.callFn('dataArrival', ['/api/foo', { data: 'bar' }]);
      flush();

      const rootCalls: unknown[][] = [];
      const dataCalls: unknown[][] = [];
      reader.onCallFn('rootArrival', (...args) => rootCalls.push(args));
      reader.onCallFn('dataArrival', (...args) => dataCalls.push(args));

      expect(rootCalls).toEqual([[0, 1]]);
      expect(dataCalls).toEqual([['/api/foo', { data: 'bar' }]]);
    });

    test('onCallFn with no buffered calls still installs handler', () => {
      const { reader } = simulatePipe();

      const calls: unknown[][] = [];
      reader.onCallFn('rootArrival', (...args) => calls.push(args));
      expect(calls).toEqual([]);

      expect(typeof reader._impl.fns.handlers.rootArrival).toBe('function');
    });

    test('reader throws on server', () => {
      const origWindow = globalThis.window;
      try {
        // @ts-ignore
        delete globalThis.window;
        expect(() => createPipe(PIPE_NAME).reader()).toThrow('cannot read from VersoPipe on the server');
      } finally {
        globalThis.window = origWindow;
      }
    });
  });
});
