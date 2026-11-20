import { describe, expect, test } from 'vitest';
import { resolvePublicRequest } from '../core/server/resolvePublicRequest';
import type { RequestContext } from '../vendor/hattip/compose';
import { fillServerSettings, type ServerSettings } from '../core/config';

function settings(overrides: Partial<ServerSettings> = {}): ServerSettings {
  return fillServerSettings(overrides);
}

function makeCtx(request: Request): RequestContext {
  return {
    request,
    url: new URL(request.url),
    method: request.method,
    ip: '',
    platform: {},
    locals: {},
    env: () => undefined,
    passThrough: () => {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response()),
    handleError: () => new Response('error', { status: 500 }),
  };
}

async function run(setts: ServerSettings, request: Request, allowLoopbackHosts = false): Promise<{ request: Request; response: Response | undefined }> {
  const ctx = makeCtx(request);
  const result = await resolvePublicRequest(setts, allowLoopbackHosts)(ctx);
  const response = result instanceof Response ? result : undefined;
  return { request: ctx.request, response };
}

// a rejected request keeps its url, so tests that expect the host to be
// accepted must also check that there is no response
async function runAccepted(setts: ServerSettings, request: Request, allowLoopbackHosts = false): Promise<Request> {
  const result = await run(setts, request, allowLoopbackHosts);
  expect(result.response).toBeUndefined();
  return result.request;
}

describe('resolvePublicRequest', () => {
  describe('without trustProxy', () => {
    test('passes through valid host', async () => {
      const raw = new Request('http://myapp.com/foo?x=1');
      const request = await runAccepted(settings({ allowedHosts: ['myapp.com'] }), raw);
      expect(request.url).toBe('http://myapp.com/foo?x=1');
    });

    test('preserves non-default port', async () => {
      const raw = new Request('http://myapp.com:8080/foo');
      const request = await runAccepted(settings({ allowedHosts: ['myapp.com:8080'] }), raw);
      expect(request.url).toBe('http://myapp.com:8080/foo');
    });

    test('preserves https protocol', async () => {
      const raw = new Request('https://myapp.com/foo');
      const request = await runAccepted(settings({ allowedHosts: ['myapp.com'] }), raw);
      expect(request.url).toBe('https://myapp.com/foo');
    });

    test('preserves method', async () => {
      const raw = new Request('http://myapp.com/foo', { method: 'POST' });
      const request = await runAccepted(settings({ allowedHosts: ['myapp.com'] }), raw);
      expect(request.method).toBe('POST');
    });

    test('preserves Cookie header', async () => {
      const raw = new Request('http://myapp.com/foo', {
        headers: { 'Cookie': 'session=abc' },
      });
      const request = await runAccepted(settings({ allowedHosts: ['myapp.com'] }), raw);
      expect(request.headers.get('cookie')).toBe('session=abc');
    });

    test('preserves path and search', async () => {
      const raw = new Request('http://myapp.com/some/deep/path?a=1&b=2');
      const request = await runAccepted(settings({ allowedHosts: ['myapp.com'] }), raw);
      const url = new URL(request.url);
      expect(url.pathname).toBe('/some/deep/path');
      expect(url.search).toBe('?a=1&b=2');
    });

    test('preserves AbortSignal', async () => {
      const controller = new AbortController();
      const raw = new Request('http://myapp.com/foo', { signal: controller.signal });
      const request = await runAccepted(settings({ allowedHosts: ['myapp.com'] }), raw);
      controller.abort('test');
      expect(request.signal.aborted).toBe(true);
    });

    test('rejects with 421 when host is not in allowedHosts', async () => {
      const raw = new Request('http://evil.com/foo');
      const { response } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
      expect(response?.status).toBe(421);
    });

    test('matches a mixed-case allowedHosts entry case-insensitively', async () => {
      const raw = new Request('http://myapp.com/foo');
      const request = await runAccepted(settings({ allowedHosts: ['MyApp.com'] }), raw);
      expect(request.url).toBe('http://myapp.com/foo');
    });

    test('rejects on host mismatch when only port differs', async () => {
      const raw = new Request('http://myapp.com:8080/foo');
      const { response } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
      expect(response?.status).toBe(421);
    });

    test('ignores X-Forwarded-Host when trustProxy is false', async () => {
      const raw = new Request('http://myapp.com/foo', {
        headers: { 'X-Forwarded-Host': 'evil.com' },
      });
      const request = await runAccepted(settings({ allowedHosts: ['myapp.com'] }), raw);
      expect(request.url).toBe('http://myapp.com/foo');
    });

    test('ignores X-Forwarded-Proto when trustProxy is false', async () => {
      const raw = new Request('http://myapp.com/foo', {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      const request = await runAccepted(settings({ allowedHosts: ['myapp.com'] }), raw);
      expect(request.url).toBe('http://myapp.com/foo');
    });
  });

  describe('with trustProxy', () => {
    test('uses X-Forwarded-Host when present', async () => {
      const raw = new Request('http://localhost:3000/foo', {
        headers: { 'X-Forwarded-Host': 'myapp.com' },
      });
      const request = await runAccepted(settings({
        trustProxy: true,
        allowedHosts: ['myapp.com'],
      }), raw);
      expect(request.url).toBe('http://myapp.com/foo');
    });

    test('uses X-Forwarded-Proto when present', async () => {
      const raw = new Request('http://myapp.com/foo', {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      const request = await runAccepted(settings({
        trustProxy: true,
        allowedHosts: ['myapp.com'],
      }), raw);
      expect(request.url).toBe('https://myapp.com/foo');
    });

    test('combines X-Forwarded-Host and X-Forwarded-Proto', async () => {
      const raw = new Request('http://localhost:3000/foo?x=1', {
        headers: {
          'X-Forwarded-Host': 'myapp.com',
          'X-Forwarded-Proto': 'https',
        },
      });
      const request = await runAccepted(settings({
        trustProxy: true,
        allowedHosts: ['myapp.com'],
      }), raw);
      expect(request.url).toBe('https://myapp.com/foo?x=1');
    });

    test('uses the first value from a comma-separated X-Forwarded-Host chain', async () => {
      const raw = new Request('http://localhost:3000/foo', {
        headers: { 'X-Forwarded-Host': 'myapp.com, proxy1.local, proxy2.local' },
      });
      const request = await runAccepted(settings({
        trustProxy: true,
        allowedHosts: ['myapp.com'],
      }), raw);
      expect(request.url).toBe('http://myapp.com/foo');
    });

    test('uses the first value from a comma-separated X-Forwarded-Proto chain', async () => {
      const raw = new Request('http://myapp.com/foo', {
        headers: { 'X-Forwarded-Proto': 'https, http' },
      });
      const request = await runAccepted(settings({
        trustProxy: true,
        allowedHosts: ['myapp.com'],
      }), raw);
      expect(request.url).toBe('https://myapp.com/foo');
    });

    test('trims whitespace from comma-separated entries', async () => {
      const raw = new Request('http://localhost:3000/foo', {
        headers: { 'X-Forwarded-Host': '   myapp.com   , proxy1.local' },
      });
      const request = await runAccepted(settings({
        trustProxy: true,
        allowedHosts: ['myapp.com'],
      }), raw);
      expect(request.url).toBe('http://myapp.com/foo');
    });

    test('falls back to incoming Host when X-Forwarded-Host is absent', async () => {
      const raw = new Request('http://myapp.com/foo');
      const request = await runAccepted(settings({
        trustProxy: true,
        allowedHosts: ['myapp.com'],
      }), raw);
      expect(request.url).toBe('http://myapp.com/foo');
    });

    test('falls back to incoming protocol when X-Forwarded-Proto is absent', async () => {
      const raw = new Request('https://myapp.com/foo');
      const request = await runAccepted(settings({
        trustProxy: true,
        allowedHosts: ['myapp.com'],
      }), raw);
      expect(request.url).toBe('https://myapp.com/foo');
    });

    test('rejects with 421 when X-Forwarded-Host is not in allowedHosts', async () => {
      const raw = new Request('http://localhost:3000/foo', {
        headers: { 'X-Forwarded-Host': 'evil.com' },
      });
      const { response } = await run(settings({
        trustProxy: true,
        allowedHosts: ['myapp.com'],
      }), raw);
      expect(response?.status).toBe(421);
    });

    test('matches mixed-case X-Forwarded-Host case-insensitively', async () => {
      const raw = new Request('http://localhost:3000/foo', {
        headers: { 'X-Forwarded-Host': 'MyApp.com' },
      });
      const request = await runAccepted(settings({
        trustProxy: true,
        allowedHosts: ['myapp.com'],
      }), raw);
      expect(new URL(request.url).host).toBe('myapp.com');
    });
  });

  describe('loopback bypass', () => {
    describe('with allowLoopbackHosts', () => {
      test.each([
        'http://localhost/foo',
        'http://127.0.0.1/foo',
        'http://localhost:5173/foo',
      ])('accepts %s when it is not in allowedHosts', async (url) => {
        const request = await runAccepted(settings({ allowedHosts: ['myapp.com'] }), new Request(url), true);
        expect(request.url).toBe(url);
      });

      test('still rejects non-loopback hosts', async () => {
        const raw = new Request('http://evil.com/foo');
        const { response } = await run(settings({ allowedHosts: ['myapp.com'] }), raw, true);
        expect(response?.status).toBe(421);
      });
    });

    describe('without allowLoopbackHosts', () => {
      test.each([
        'http://localhost/foo',
        'http://127.0.0.1/foo',
      ])('rejects %s when it is not in allowedHosts', async (url) => {
        const { response } = await run(settings({ allowedHosts: ['myapp.com'] }), new Request(url));
        expect(response?.status).toBe(421);
      });

      test('accepts localhost when it is in allowedHosts', async () => {
        const raw = new Request('http://localhost/foo');
        const request = await runAccepted(settings({ allowedHosts: ['localhost'] }), raw);
        expect(request.url).toBe('http://localhost/foo');
      });
    });
  });
});
