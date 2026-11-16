import { beforeEach, describe, expect, test } from 'vitest';
import { getCookie, setCookie } from '../core/common/cookies';
import { ServerCookies } from '../core/server/ServerCookies';
import { serverSide, clientSide } from '../userland/testing/isomorphic';
import { testWithRLS } from '../userland/testing/rls';

function makeRequest(cookieHeader?: string): Request {
  const headers: HeadersInit = {};
  if (cookieHeader !== undefined) headers['Cookie'] = cookieHeader;
  return new Request('http://localhost/', { headers });
}

describe('cookies', () => {
  serverSide(() => {
    describe('getCookie', () => {
      testWithRLS('returns response cookie when set', () => {
        const sc = new ServerCookies(makeRequest());
        sc.setResponseCookie('session', 'resp-value');
        expect(getCookie('session')).toBe('resp-value');
      });

      testWithRLS('returns request cookie when no response cookie is set', () => {
        new ServerCookies(makeRequest('session=req-value'));
        expect(getCookie('session')).toBe('req-value');
      });

      testWithRLS('response cookie takes precedence over request cookie', () => {
        const sc = new ServerCookies(makeRequest('session=req-value'));
        sc.setResponseCookie('session', 'resp-value');
        expect(getCookie('session')).toBe('resp-value');
      });

      testWithRLS('returns undefined when cookie not found', () => {
        new ServerCookies(makeRequest());
        expect(getCookie('missing')).toBeUndefined();
      });

      // the expected values match what the client reads from document.cookie
      // after the browser applies the response
      testWithRLS('an empty response cookie overrides the request cookie', () => {
        const sc = new ServerCookies(makeRequest('session=req-value'));
        sc.setResponseCookie('session', '');
        expect(getCookie('session')).toBe('');
      });

      testWithRLS.each([
        ['maxAge: 0', { maxAge: 0 }],
        ['expires in the past', { expires: new Date(0) }],
      ])('a response cookie deleted with %s returns undefined, not the request cookie', (_, options) => {
        const sc = new ServerCookies(makeRequest('session=req-value'));
        sc.setResponseCookie('session', '', options);
        expect(getCookie('session')).toBeUndefined();
      });

      testWithRLS('an empty request cookie returns an empty string', () => {
        new ServerCookies(makeRequest('session='));
        expect(getCookie('session')).toBe('');
      });
    });

    describe('setCookie', () => {
      testWithRLS('delegates to ServerCookies.setResponseCookie', () => {
        const sc = new ServerCookies(makeRequest());
        setCookie('theme', 'dark');
        expect(sc.getResponseCookie('theme')).toEqual({ kind: 'value', value: 'dark' });
      });

      testWithRLS('delegates with options', () => {
        const sc = new ServerCookies(makeRequest());
        setCookie('auth', 'token123', { path: '/', httpOnly: true });
        expect(sc.getResponseCookie('auth')).toEqual({ kind: 'value', value: 'token123' });
      });
    });
  });

  clientSide(() => {
    function clearAllCookies() {
      document.cookie.split(';').forEach((c) => {
        const name = c.trim().split('=')[0];
        if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      });
    }

    describe('getCookie', () => {
      beforeEach(clearAllCookies);

      test('parses document.cookie', () => {
        document.cookie = 'foo=bar';
        expect(getCookie('foo')).toBe('bar');
      });

      test('returns undefined for missing cookie', () => {
        expect(getCookie('nonexistent')).toBeUndefined();
      });
    });

    describe('setCookie', () => {
      beforeEach(clearAllCookies);

      test('sets document.cookie', () => {
        setCookie('theme', 'dark');
        expect(document.cookie).toContain('theme=dark');
      });
    });
  });
});
