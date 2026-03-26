import React from 'react';
import { test, expect, describe, vi } from 'vitest';
import { handleRoute } from '@/sluice/server/handleRoute';
import { Root } from '@/sluice/core/components/Root';
import { definePage, type PageInit } from '@/sluice/Page';
import { defineEndpoint, type EndpointInit } from '@/sluice/Endpoint';
import { setCookie } from '@/sluice/util/cookies';
import type { RouteAssets } from '@/sluice/bundle';

// --- Helpers ---

const DEFAULT_ROUTE_ASSETS: RouteAssets = { scripts: ['/client.js'], stylesheets: [] };

function makePage(directive: { status: number }, opts?: { onRouteDirective?: () => void }): PageInit {
  return () => ({
    getRouteDirective() {
      opts?.onRouteDirective?.();
      return directive;
    },
    getElements() { return [<Root><div>Hello</div></Root>]; },
    getTitle() { return 'Test'; },
    getHeadStylesheets() { return []; },
  });
}

function makeEndpoint(directive: { status: number }, data: string): EndpointInit {
  return () => ({
    getRouteDirective() { return directive; },
    getContentType() { return 'application/json'; },
    getResponseData() { return data; },
  });
}

async function routePage(init: PageInit, options?: Partial<{ routeAssets: RouteAssets }>) {
  const req = new Request('http://localhost/');
  return handleRoute('page', req, definePage(init), {}, [], {
    routeAssets: options?.routeAssets ?? DEFAULT_ROUTE_ASSETS,
    urlPrefix: 'http://localhost',
  });
}

async function routeEndpoint(init: EndpointInit) {
  const req = new Request('http://localhost/');
  return handleRoute('endpoint', req, defineEndpoint(init), {}, [], {
    routeAssets: DEFAULT_ROUTE_ASSETS,
    urlPrefix: 'http://localhost',
  });
}

// --- Tests ---

describe('handleRoute', () => {

  test('uses status code from getRouteDirective', async () => {
    const response = await routePage(makePage({ status: 200 }));
    expect(response.status).toBe(200);
  });

  test('propagates non-200 status codes', async () => {
    const response = await routePage(makePage({ status: 404 }));
    expect(response.status).toBe(404);
  });

  test('returns 500 when getRouteDirective throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const init: PageInit = () => ({
      getRouteDirective() { throw new Error('boom'); },
      getElements() { return []; },
      getTitle() { return ''; },
      getHeadStylesheets() { return []; },
    });

    const response = await routePage(init);

    expect(response.status).toBe(500);
    expect(response.body).toBeNull();
    spy.mockRestore();
  });

  test('sets Content-Type header', async () => {
    const response = await routePage(makePage({ status: 200 }));
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  test('includes response cookies in headers', async () => {
    const init: PageInit = () => ({
      getRouteDirective() {
        setCookie('session', 'abc123', { path: '/' });
        return { status: 200 };
      },
      getElements() { return [<Root><div>Hello</div></Root>]; },
      getTitle() { return 'Test'; },
      getHeadStylesheets() { return []; },
    });

    const response = await routePage(init);

    const setCookieHeader = response.headers.get('Set-Cookie');
    expect(setCookieHeader).toContain('session=abc123');
    expect(setCookieHeader).toContain('Path=/');
  });

  test('dispatches to endpoint handler', async () => {
    const data = JSON.stringify({ ok: true });
    const response = await routeEndpoint(makeEndpoint({ status: 200 }, data));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe(data);
  });

  test('calls getRouteDirective on the handler', async () => {
    let called = false;
    const response = await routePage(makePage({ status: 200 }, {
      onRouteDirective: () => { called = true; },
    }));

    expect(called).toBe(true);
  });
});
