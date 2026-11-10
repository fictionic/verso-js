import { describe, expect, test } from 'vitest';
import { testWithRLS } from '../userland/testing/rls';
import { ServerCookies } from '../core/server/ServerCookies';
import { getServerStash } from '../core/server/stash';

function makeRequest(cookieHeader?: string): Request {
  const headers: HeadersInit = {};
  if (cookieHeader !== undefined) headers['Cookie'] = cookieHeader;
  return new Request('http://localhost/', { headers });
}

describe('ServerCookies', () => {
  testWithRLS('parses Cookie header correctly', () => {
    const sc = new ServerCookies(makeRequest('a=1; b=2'));
    expect(sc.getRequestCookie('a')).toBe('1');
    expect(sc.getRequestCookie('b')).toBe('2');
  });

  testWithRLS('getRequestCookie returns undefined for missing key', () => {
    const sc = new ServerCookies(makeRequest('a=1; b=2'));
    expect(sc.getRequestCookie('z')).toBeUndefined();
  });

  testWithRLS('setResponseCookie before consumeHeaders stores the cookie', () => {
    const sc = new ServerCookies(makeRequest());
    sc.setResponseCookie('session', 'abc123');
    expect(sc.getResponseCookie('session')).toBe('abc123');
  });

  testWithRLS('setResponseCookie after headers are locked throws', () => {
    const sc = new ServerCookies(makeRequest());
    getServerStash().headersLocked = true;
    expect(() => sc.setResponseCookie('session', 'abc123')).toThrow(
      'cannot set cookies after HTTP headers have been sent'
    );
  });

  testWithRLS('consumeHeaders returns Headers with Set-Cookie values', () => {
    const sc = new ServerCookies(makeRequest());
    sc.setResponseCookie('token', 'xyz', { path: '/', httpOnly: true });
    const headers = sc.getResponseSetCookieHeaders();
    const setCookie = headers.get('Set-Cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('token=xyz');
  });

  testWithRLS('setResponseSetCookieHeaders parses and stores multiple Set-Cookie strings', () => {
    const sc = new ServerCookies(makeRequest());
    sc.setResponseSetCookieHeaders([
      'user=alice; Path=/',
      'theme=dark; Path=/; HttpOnly',
    ]);
    expect(sc.getResponseCookie('user')).toBe('alice');
    expect(sc.getResponseCookie('theme')).toBe('dark');
  });

  testWithRLS('getResponseCookie returns pending response cookie value', () => {
    const sc = new ServerCookies(makeRequest());
    sc.setResponseCookie('lang', 'en');
    expect(sc.getResponseCookie('lang')).toBe('en');
    expect(sc.getResponseCookie('missing')).toBeUndefined();
  });

  testWithRLS('static get() returns instance inside request after construction', () => {
    const sc = new ServerCookies(makeRequest());
    expect(ServerCookies.get()).toBe(sc);
  });

  testWithRLS('static get() returns undefined inside request before any construction', () => {
    expect(ServerCookies.get()).toBeUndefined();
  });

  test('static get() throws outside request', () => {
    expect(() => ServerCookies.get()).toThrow('RLS() access outside of request!');
  });
});
