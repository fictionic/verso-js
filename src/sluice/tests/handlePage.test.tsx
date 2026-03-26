import React from 'react';
import { test, expect, describe } from 'vitest';
import { handleRoute } from '@/sluice/server/handleRoute';
import { Root, makeRootComponent } from '@/sluice/core/components/Root';
import RootContainer from '@/sluice/core/components/RootContainer';
import TheFold from '@/sluice/core/components/TheFold';
import { definePage, type PageInit, type Stylesheet } from '@/sluice/Page';
import type { RouteAssets } from '@/sluice/bundle';

// --- Helpers ---

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

const TEST_RENDER_TIMEOUT_MS = 150;
const DEFAULT_ROUTE_ASSETS: RouteAssets = { scripts: ['/client.js'], stylesheets: [] };

async function render(init: PageInit, routeAssets: RouteAssets = DEFAULT_ROUTE_ASSETS): Promise<string> {
  const req = new Request('http://localhost/');
  const response = await handleRoute('page', req, definePage(init), {}, [], { routeAssets, renderTimeout: TEST_RENDER_TIMEOUT_MS, urlPrefix: 'http://localhost' });
  return collectStream(response.body!);
}

function simplePage(elements: React.ReactElement[], opts?: { title?: string; stylesheets?: Stylesheet[] }): PageInit {
  return () => ({
    getRouteDirective() { return { status: 200 } },
    getElements() { return elements; },
    getTitle() { return opts?.title ?? 'Test'; },
    getHeadStylesheets() { return opts?.stylesheets ?? []; },
  });
}

// --- Tests ---

describe('handlePage', () => {

  test('renders a basic page with a single root element', async () => {
    const P = simplePage([
      <Root><div>Hello</div></Root>,
    ]);
    const html = await render(P);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Test</title>');
    expect(html).toContain('Hello');
    expect(html).toContain('data-sluice-root');
    expect(html).toContain('</body></html>');
  });

  test('renders page title and inline styles', async () => {
    const P = simplePage([], {
      title: 'My App',
      stylesheets: [{ text: 'body { color: red; }' }],
    });
    const html = await render(P);

    expect(html).toContain('<title>My App</title>');
    expect(html).toContain('<style type="text/css">body { color: red; }</style>');
  });

  test('renders stylesheet link tags', async () => {
    const P = simplePage([], {
      stylesheets: [{ href: '/styles.css' }],
    });
    const html = await render(P);

    expect(html).toContain('<link rel="stylesheet" href="/styles.css">');
  });

  test('renders multiple root elements in order', async () => {
    const P = simplePage([
      <Root><div>First</div></Root>,
      <Root><div>Second</div></Root>,
      <Root><div>Third</div></Root>,
    ]);
    const html = await render(P);

    const firstIdx = html.indexOf('First');
    const secondIdx = html.indexOf('Second');
    const thirdIdx = html.indexOf('Third');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  test('waits for `when` promise before rendering', async () => {
    let resolve!: () => void;
    const when = new Promise<null>(r => { resolve = () => r(null); });

    const P = simplePage([
      <Root when={when}><div>Delayed</div></Root>,
    ]);
    const req = new Request('http://localhost/');
    const response = await handleRoute('page', req, definePage(P), {}, [], { routeAssets: DEFAULT_ROUTE_ASSETS, urlPrefix: 'http://localhost' });

    // Resolve the promise so the stream can complete
    resolve();
    const html = await collectStream(response.body!);

    expect(html).toContain('Delayed');
  });

  test('renders roots in document order even if later roots resolve first', async () => {
    let resolveFirst!: () => void;
    const slowWhen = new Promise<null>(r => { resolveFirst = () => r(null); });

    const P = simplePage([
      <Root when={slowWhen}><div>Slow</div></Root>,
      <Root><div>Fast</div></Root>,
    ]);
    const req = new Request('http://localhost/');
    const response = await handleRoute('page', req, definePage(P), {}, [], { routeAssets: DEFAULT_ROUTE_ASSETS, urlPrefix: 'http://localhost' });

    // Fast resolves immediately, slow resolves after
    resolveFirst();
    const html = await collectStream(response.body!);

    expect(html.indexOf('Slow')).toBeLessThan(html.indexOf('Fast'));
  });

  test('TheFold triggers client bootstrap before below-fold content', async () => {
    const P = simplePage([
      <Root><div>Above</div></Root>,
      <TheFold />,
      <Root><div>Below</div></Root>,
    ]);
    const html = await render(P);

    expect(html).toContain('Above');
    expect(html).toContain('Below');
    // Client bundle script should appear before below-fold content
    const bootstrapIdx = html.indexOf('type="module"');
    const belowIdx = html.indexOf('Below');
    expect(bootstrapIdx).toBeGreaterThan(-1);
    expect(bootstrapIdx).toBeLessThan(belowIdx);
  });

  test('bootstrap happens at end if no TheFold', async () => {
    const P = simplePage([
      <Root><div>One</div></Root>,
      <Root><div>Two</div></Root>,
    ]);
    const html = await render(P);

    // Client bundle script should come after all root content
    const twoIdx = html.indexOf('Two');
    const bootstrapIdx = html.indexOf('type="module"');
    expect(twoIdx).toBeLessThan(bootstrapIdx);
  });

  test('uses the provided script URLs from routeAssets', async () => {
    const P = simplePage([
      <Root><div>Hello</div></Root>,
    ]);
    const html = await render(P, { scripts: ['/my-bundle.js'], stylesheets: [] });

    expect(html).toContain('src="/my-bundle.js"');
  });

  test('RootContainer wraps children in container divs', async () => {
    const P = simplePage([
      <RootContainer style={{ maxWidth: 800 }}>
        <Root><div>Inside</div></Root>
      </RootContainer>,
    ]);
    const html = await render(P);

    expect(html).toContain('max-width');
    expect(html).toContain('Inside');
  });

  test('nested RootContainers flatten correctly', async () => {
    const P = simplePage([
      <RootContainer id="outer">
        <RootContainer id="inner">
          <Root><div>Deep</div></Root>
        </RootContainer>
      </RootContainer>,
    ]);
    const html = await render(P);

    expect(html).toContain('id="outer"');
    expect(html).toContain('id="inner"');
    expect(html).toContain('Deep');
    // Container divs should appear in order
    expect(html.indexOf('id="outer"')).toBeLessThan(html.indexOf('id="inner"'));
  });

  test('bare elements are wrapped in RootElement automatically', async () => {
    const P = simplePage([
      <div>Bare</div>,
    ]);
    const html = await render(P);

    expect(html).toContain('Bare');
    expect(html).toContain('data-sluice-root');
  });

  test('makeRoot components work as custom root elements', async () => {
    const CustomRoot = makeRootComponent<{ label: string; children: React.ReactNode }>(
      ({ label, children }) => <div><span>{label}</span>{children}</div>,
      ({ label }) => ({ when: Promise.resolve(null) }),
    );

    const P = simplePage([
      <CustomRoot label="custom"><p>Content</p></CustomRoot>,
    ]);
    const html = await render(P);

    expect(html).toContain('custom');
    expect(html).toContain('Content');
  });

  test('makeRoot derives when from custom props', async () => {
    let resolved = false;
    let resolve!: () => void;
    const when = new Promise<null>(r => { resolve = () => { resolved = true; r(null); }; });

    const DelayedRoot = makeRootComponent<{ delay: Promise<null>; children: React.ReactNode }>(
      ({ children }) => <div>{children}</div>,
      ({ delay }) => ({ when: delay }),
    );

    const P = simplePage([
      <DelayedRoot delay={when}><span>Waited</span></DelayedRoot>,
    ]);
    const req = new Request('http://localhost/');
    const response = await handleRoute('page', req, definePage(P), {}, [], { routeAssets: DEFAULT_ROUTE_ASSETS, urlPrefix: 'http://localhost' });

    resolve();
    const html = await collectStream(response.body!);

    expect(resolved).toBe(true);
    expect(html).toContain('Waited');
  });

  test('scheduleRender merges resolved props via cloneElement', async () => {
    const DataRoot = makeRootComponent<{ message?: string; children: React.ReactNode }>(
      ({ message, children }) => <div><span>{message ?? 'none'}</span>{children}</div>,
      () => ({ when: Promise.resolve({ message: 'injected' }) }),
    );

    const P = simplePage([
      <DataRoot><p>Body</p></DataRoot>,
    ]);
    const html = await render(P);

    expect(html).toContain('injected');
    expect(html).toContain('Body');
  });

  test('skips rendering on renderToString error', async () => {
    const BrokenComponent = () => { throw new Error('boom'); };
    const BrokenRoot = makeRootComponent<{ children?: React.ReactNode }>(
      () => <BrokenComponent />,
      () => ({}),
    );

    const P = simplePage([
      <Root><div>Good</div></Root>,
      <BrokenRoot />,
      <Root><div>Also Good</div></Root>,
    ]);
    const html = await render(P);

    expect(html).toContain('Good');
    expect(html).toContain('Also Good');
    // Should NOT contain an error div
    expect(html).not.toContain('Render error');
    expect(html).not.toContain('boom');
  });

  test('includes client bootstrap script', async () => {
    const P = simplePage([
      <Root><div>Hello</div></Root>,
    ]);
    const html = await render(P, { scripts: ['/bundle.js'], stylesheets: [] });

    expect(html).toContain('<script async type="module" src="/bundle.js">');
  });

  test('times out and skips pending elements', async () => {
    const neverResolves = new Promise<null>(() => {});

    const P = simplePage([
      <Root><div>Ready</div></Root>,
      <Root when={neverResolves}><div>Stuck</div></Root>,
      <Root><div>Also Ready</div></Root>,
    ]);

    const req = new Request('http://localhost/');
    const response = await handleRoute('page', req, definePage(P), {}, [], { routeAssets: DEFAULT_ROUTE_ASSETS, renderTimeout: 50, urlPrefix: 'http://localhost' });
    const html = await collectStream(response.body!);

    expect(html).toContain('Ready');
    expect(html).toContain('Also Ready');
    expect(html).not.toContain('Stuck');
    expect(html).toContain('</body></html>');
  });

  test('calls handleRoute on the page', async () => {
    let handleRouteCalled = false;
    const init: PageInit = () => ({
      getRouteDirective() { handleRouteCalled = true; return { status: 200 }; },
      getElements() { return [<Root><div>Hi</div></Root>]; },
      getTitle() { return 'Test'; },
      getHeadStylesheets() { return []; },
    });
    await render(init);

    expect(handleRouteCalled).toBe(true);
  });
});
