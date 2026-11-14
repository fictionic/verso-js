import {describe, test, expect} from 'vitest';
import {writeHeader, renderOpenTag} from '../core/server/writeHeader';
import type {StandardizedPage, PageOptionalMethods} from '../core/common/handler/Page';
import {
  PAGE_HEADER_STYLE_ELEMENT_ATTR,
  PAGE_HEADER_LINK_ELEMENT_ATTR,
} from '../core/common/constants';
import {stubPage} from './helpers/stubHandlers';

function makePage(overrides: Partial<PageOptionalMethods>): StandardizedPage {
  return {...stubPage(() => []), ...overrides};
}

async function collect(page: StandardizedPage): Promise<string> {
  const out: string[] = [];
  await writeHeader(page, s => out.push(s));
  return out.join('');
}

describe('writeHeader', () => {
  describe('document order & charset', () => {
    test('charset meta is first', async () => {
      const page = makePage({
        getTitle: () => 'My Title',
      });
      const html = await collect(page);
      const charsetIdx = html.indexOf('<meta charset="utf-8">');
      const titleIdx = html.indexOf('<title>');
      expect(charsetIdx).toBe(0);
      expect(charsetIdx).toBeLessThan(titleIdx);
    });

    test('sections render in order: charset -> meta -> title -> link -> stylesheets', async () => {
      const page = makePage({
        getMetaTags: () => [{name: 'description', content: 'desc'}],
        getTitle: () => 'Page',
        getLinkTags: () => [{rel: 'canonical', href: 'https://example.com/'}],
        getStylesheets: () => [{href: 'style.css'}],
      });
      const html = await collect(page);
      const charsetIdx = html.indexOf('<meta charset="utf-8">');
      const metaIdx = html.indexOf('<meta name=');
      const titleIdx = html.indexOf('<title>');
      // the sentinel attr is first, which tells link tags from stylesheet links
      const linkIdx = html.indexOf(`<link ${PAGE_HEADER_LINK_ELEMENT_ATTR}`);
      const styleIdx = html.indexOf(`<link ${PAGE_HEADER_STYLE_ELEMENT_ATTR}`);
      expect(charsetIdx).toBeLessThan(metaIdx);
      expect(metaIdx).toBeLessThan(titleIdx);
      expect(titleIdx).toBeLessThan(linkIdx);
      expect(linkIdx).toBeLessThan(styleIdx);
    });
  });

  describe('title', () => {
    test('string title renders <title>...</title>', async () => {
      const html = await collect(makePage({getTitle: () => 'Hello World'}));
      expect(html).toContain('<title>Hello World</title>');
    });

    test('HTML-sensitive characters in title are escaped', async () => {
      const html = await collect(makePage({getTitle: () => '<script>alert("x&y")</script>'}));
      expect(html).toContain('<title>&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;</title>');
      expect(html).not.toContain('<script>');
    });

    test('null title renders no <title>', async () => {
      const html = await collect(makePage({getTitle: () => null}));
      expect(html).not.toContain('<title>');
    });
  });

  describe('meta tags', () => {
    test('name meta tag renders <meta name=... content=...>', async () => {
      const html = await collect(makePage({
        getMetaTags: () => [{name: 'description', content: 'A page'}],
      }));
      expect(html).toContain('<meta name="description" content="A page">');
    });

    test('property meta tag renders <meta property=... content=...>', async () => {
      const html = await collect(makePage({
        getMetaTags: () => [{property: 'og:title', content: 'OG Title'}],
      }));
      expect(html).toContain('<meta property="og:title" content="OG Title">');
    });

    test('noscript: true wraps the meta in <noscript>', async () => {
      const html = await collect(makePage({
        getMetaTags: () => [{name: 'robots', content: 'noindex', noscript: true}],
      }));
      expect(html).toContain('<noscript><meta name="robots" content="noindex"></noscript>');
    });
  });

  describe('link tags', () => {
    test('renders <link> with rel/href attributes', async () => {
      const html = await collect(makePage({
        getLinkTags: () => [{rel: 'canonical', href: 'https://example.com/'}],
      }));
      expect(html).toContain('rel="canonical"');
      expect(html).toContain('href="https://example.com/"');
      expect(html).toContain(`${PAGE_HEADER_LINK_ELEMENT_ATTR}`);
    });

    test('renders optional attributes: as, crossorigin, type', async () => {
      const html = await collect(makePage({
        getLinkTags: () => [{rel: 'preload', href: 'font.woff2', as: 'font', crossorigin: 'anonymous', type: 'font/woff2'}],
      }));
      expect(html).toContain('as="font"');
      expect(html).toContain('crossorigin="anonymous"');
      expect(html).toContain('type="font/woff2"');
    });
  });

  describe('stylesheets', () => {
    test('external stylesheet renders <link rel="stylesheet">', async () => {
      const html = await collect(makePage({
        getStylesheets: () => [{href: 'main.css'}],
      }));
      expect(html).toContain(`${PAGE_HEADER_STYLE_ELEMENT_ATTR}`);
      expect(html).toContain('href="main.css"');
      expect(html).toContain('rel="stylesheet"');
      expect(html).not.toContain('<style');
    });

    test('inline stylesheet renders <style>...text...</style>', async () => {
      const html = await collect(makePage({
        getStylesheets: () => [{text: 'body { color: red; }'}],
      }));
      expect(html).toContain('<style');
      expect(html).toContain('body { color: red; }');
      expect(html).toContain('</style>');
    });

    test('</style in inline text is escaped (case-insensitive)', async () => {
      const html = await collect(makePage({
        getStylesheets: () => [{text: 'a { content: "</style><script>evil()</script>" }</STYLE>end'}],
      }));
      expect(html).toContain('<\\/style');
      const closingTagCount = html.split('</style>').length - 1;
      expect(closingTagCount).toBe(1);
    });
  });

  describe('async getters', () => {
    test('awaits async page methods', async () => {
      const page = makePage({
        getTitle: async () => 'Async Title',
        getMetaTags: async () => [{name: 'author', content: 'me'}],
      });
      const html = await collect(page);
      expect(html).toContain('<title>Async Title</title>');
      expect(html).toContain('<meta name="author"');
    });
  });
});

describe('renderOpenTag', () => {
  test('no attrs: no space before >', () => {
    expect(renderOpenTag('div', {})).toBe('<div>');
  });

  test('single valued attr: name="value"', () => {
    expect(renderOpenTag('meta', {charset: 'utf-8'})).toBe('<meta charset="utf-8">');
  });

  test('valueless attr renders as bare name', () => {
    expect(renderOpenTag('script', {async: '', src: 'a.js'})).toBe('<script async src="a.js">');
  });

  test('attr values are HTML-escaped', () => {
    expect(renderOpenTag('a', {href: '?a=1&b=<2>'})).toBe('<a href="?a=1&amp;b=&lt;2&gt;">');
  });
});
