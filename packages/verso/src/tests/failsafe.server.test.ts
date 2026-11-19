import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleFailsafeTimeouts } from '../core/server/failsafe';
import type { ServerSettings } from '../core/config';
import type { RequestContext } from '../vendor/hattip/compose';

function makeRequest(signal?: AbortSignal): Request {
  return new Request('http://localhost/', signal ? { signal } : {});
}

function makeCtx(request: Request, next: () => Promise<Response>): RequestContext {
  return {
    request,
    next,
    ip: '127.0.0.1',
    platform: undefined,
    env: () => undefined,
    passThrough: () => {},
    waitUntil: () => {},
    url: new URL('http://localhost/'),
    method: 'GET',
    locals: {},
    handleError: () => new Response('error', { status: 500 }),
  };
}

function makeSettings(ttfb: number, response: number): ServerSettings {
  return {
    allowedHosts: ['localhost'],
    trustProxy: false,
    fetchOrigin: 'request-host',
    failsafeTtfbDeadlineMs: ttfb,
    failsafeResponseDeadlineMs: response,
  };
}

describe('handleFailsafeTimeouts', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('TTFB deadline', () => {
    test('returns the next() response when it resolves before the TTFB deadline', async () => {
      const next = vi.fn().mockResolvedValue(new Response('ok'));
      const handler = handleFailsafeTimeouts(makeSettings(1000, 5000));
      const ctx = makeCtx(makeRequest(), next);

      const resultPromise = handler(ctx) as Promise<Response>;
      await vi.advanceTimersByTimeAsync(100); // well before 1000ms deadline
      const result = await resultPromise;

      expect(result.status).toBe(200);
    });

    test('returns a 504 "Failsafe timeout" when next() is pending past the TTFB deadline', async () => {
      const next = vi.fn().mockReturnValue(new Promise<Response>(() => {})); // never resolves
      const handler = handleFailsafeTimeouts(makeSettings(500, 5000));
      const ctx = makeCtx(makeRequest(), next);

      const resultPromise = handler(ctx) as Promise<Response>;
      await vi.advanceTimersByTimeAsync(501);
      const result = await resultPromise;

      expect(result.status).toBe(504);
      expect(await result.text()).toBe('Failsafe timeout');
    });

    test('a fast response clears the TTFB timer', async () => {
      // no body, so the response deadline timer is cleared too. only the TTFB
      // timer can be left.
      const next = vi.fn().mockResolvedValue(new Response(null));
      const handler = handleFailsafeTimeouts(makeSettings(500, 5000));
      const ctx = makeCtx(makeRequest(), next);

      const result = await (handler(ctx) as Promise<Response>);

      expect(result.status).toBe(200);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('Signal merging', () => {
    test('ctx.request.signal is a different signal than the original after calling the handler', () => {
      const upstream = new AbortController();
      const request = makeRequest(upstream.signal);
      const originalSignal = request.signal;
      const next = vi.fn().mockResolvedValue(new Response('ok'));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 5000));
      const ctx = makeCtx(request, next);

      // async fn runs sync code before its first await, so ctx.request is updated
      // synchronously before handler() returns its Promise
      void (handler(ctx) as Promise<Response>);

      expect(ctx.request.signal).not.toBe(originalSignal);
    });

    test('aborting the upstream signal aborts the merged signal downstream receives', () => {
      const upstream = new AbortController();
      const request = makeRequest(upstream.signal);
      const next = vi.fn().mockResolvedValue(new Response('ok'));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 5000));
      const ctx = makeCtx(request, next);

      void (handler(ctx) as Promise<Response>);
      const mergedSignal = ctx.request.signal;

      expect(mergedSignal.aborted).toBe(false);
      upstream.abort();
      // AbortSignal.any propagates synchronously
      expect(mergedSignal.aborted).toBe(true);
    });
  });

  describe('Response-stream deadline', () => {
    test('a body that finishes before the response deadline passes through without an abort', async () => {
      const encoder = new TextEncoder();
      let ctrl!: ReadableStreamDefaultController<Uint8Array>;
      const readable = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
      const next = vi.fn().mockResolvedValue(new Response(readable, { status: 200 }));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 1000));
      const ctx = makeCtx(makeRequest(), next);

      const result = await (handler(ctx) as Promise<Response>);

      ctrl.enqueue(encoder.encode('complete'));
      ctrl.close();

      const text = await result.text();
      expect(text).toBe('complete');

      // the timer was cleared on pipe completion
      await vi.advanceTimersByTimeAsync(2000);
      expect(ctx.request.signal.aborted).toBe(false);
    });

    test('a body that stalls past the response deadline aborts the merged signal', async () => {
      const encoder = new TextEncoder();
      const readable = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode('partial'));
          // Never closes, so the body stalls
        },
      });
      const next = vi.fn().mockResolvedValue(new Response(readable, { status: 200 }));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 1000));
      const ctx = makeCtx(makeRequest(), next);

      const result = await (handler(ctx) as Promise<Response>);
      const mergedSignal = ctx.request.signal;

      const reader = result.body!.getReader();
      const { value } = await reader.read();
      expect(value).toBeDefined(); // received the partial chunk

      await vi.advanceTimersByTimeAsync(999);
      expect(mergedSignal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(mergedSignal.aborted).toBe(true);

      reader.cancel().catch(() => {});
    });

    test('a response with no body clears the response deadline timer', async () => {
      const next = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 1000));
      const ctx = makeCtx(makeRequest(), next);

      const result = await (handler(ctx) as Promise<Response>);
      expect(result.status).toBe(204);

      // timer was cleared because body was null
      await vi.advanceTimersByTimeAsync(2000);
      expect(ctx.request.signal.aborted).toBe(false);
    });
  });

  describe('Write-after-abort guard', () => {
    test('an upstream abort mid-stream errors the body stream', async () => {
      const upstream = new AbortController();
      const encoder = new TextEncoder();
      let ctrl!: ReadableStreamDefaultController<Uint8Array>;
      const readable = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
      const next = vi.fn().mockResolvedValue(new Response(readable, { status: 200 }));
      const handler = handleFailsafeTimeouts(makeSettings(5000, 5000));
      const ctx = makeCtx(makeRequest(upstream.signal), next);

      const resultPromise = handler(ctx) as Promise<Response>;
      // Handler promise resolves normally (does not reject from abort)
      const result = await resultPromise;
      await expect(resultPromise).resolves.toBeDefined();

      const reader = result.body!.getReader();

      // Send first chunk
      ctrl.enqueue(encoder.encode('chunk1'));
      const { value: chunk1 } = await reader.read();
      expect(chunk1).toBeDefined();

      // Abort upstream mid-stream; pipeTo (signal: upstreamSignal) aborts,
      // erroring ts.writable (preventCancel keeps res.body alive)
      upstream.abort();

      await expect(reader.read()).rejects.toThrow();
    });
  });
});
