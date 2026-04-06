// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost" }
import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { PAGE_HEADER_STYLE_ELEMENT_ATTR } from '../core/constants';
import { getStyleTransitioner, type StyleTransitioner } from '../client/styles';

const BASE = 'http://localhost';
const ROUTE = 'TestRoute';
const extStyle = (path: string) => ({ href: path });
const inlineStyle = (text: string, attrs?: { type?: string; media?: string }) => ({ text, ...attrs });

function addServerLink(path: string) {
  const link = document.createElement('link');
  link.href = BASE + path;
  link.setAttribute(PAGE_HEADER_STYLE_ELEMENT_ATTR, '');
  document.head.appendChild(link);
  return link;
}

function addServerStyle(text: string, attrs?: { type?: string; media?: string }) {
  const style = document.createElement('style');
  style.innerHTML = text;
  if (attrs?.type) style.type = attrs.type;
  if (attrs?.media) style.media = attrs.media;
  style.setAttribute(PAGE_HEADER_STYLE_ELEMENT_ATTR, '');
  document.head.appendChild(style);
  return style;
}

function getLinks(): HTMLLinkElement[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[href]')];
}

function getStyles(): HTMLStyleElement[] {
  return [...document.head.querySelectorAll<HTMLStyleElement>('style')];
}

describe('StyleTransitioner', () => {
  let st: StyleTransitioner;
  // jsdom does not fire `load` events on `<link>` elements, so the transitioner's
  // await on `link.onload` hangs forever. Simulate the load event whenever a link
  // is appended to the head.
  let linkLoadObserver: MutationObserver;

  beforeEach(() => {
    document.head.innerHTML = '';
    // Empty manifest: all stylesheets go through pageStylesheets param.
    st = getStyleTransitioner({});
    linkLoadObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node instanceof HTMLLinkElement) {
            queueMicrotask(() => {
              const onload = node.onload as ((e: Event) => void) | null;
              if (onload) onload(new Event('load'));
            });
          }
        });
      }
    });
    linkLoadObserver.observe(document.head, { childList: true });
  });

  afterEach(() => {
    linkLoadObserver?.disconnect();
  });

  describe('readServerStyles', () => {
    test('picks up server-rendered link elements', async () => {
      addServerLink('/a.css');
      addServerLink('/b.css');
      st.readServerStyles();

      // Transitioning to the same styles should not re-add them
      await st.transitionStyles(ROUTE, [extStyle('/a.css'), extStyle('/b.css')]);
      expect(getLinks()).toHaveLength(2);
    });

    test('picks up server-rendered inline style elements', async () => {
      addServerStyle('body { color: red }');
      st.readServerStyles();

      await st.transitionStyles(ROUTE, [{ text: 'body { color: red }' }]);
      expect(getStyles()).toHaveLength(1);
    });

    test('ignores elements without the verso attribute', async () => {
      const link = document.createElement('link');
      link.href = '/unrelated.css';
      document.head.appendChild(link);

      st.readServerStyles();

      // Transitioning to empty should not remove the unrelated link
      await st.transitionStyles(ROUTE, []);
      expect(getLinks()).toHaveLength(1);
    });
  });

  describe('transitionStyles', () => {
    test('adds new external stylesheets', async () => {
      st.readServerStyles();
      await st.transitionStyles(ROUTE, [extStyle('/new.css')]);

      const links = getLinks();
      expect(links).toHaveLength(1);
      expect(links[0]!.href).toContain('/new.css');
    });

    test('adds new inline stylesheets', async () => {
      st.readServerStyles();
      await st.transitionStyles(ROUTE, [{ text: '.foo { color: blue }' }]);

      const styles = getStyles();
      expect(styles).toHaveLength(1);
      expect(styles[0]!.innerHTML).toBe('.foo { color: blue }');
    });

    test('removes stale stylesheets', async () => {
      addServerLink('/old.css');
      addServerStyle('.old { display: none }');
      st.readServerStyles();

      const cleanup = await st.transitionStyles(ROUTE, []);
      cleanup();
      expect(getLinks()).toHaveLength(0);
      expect(getStyles()).toHaveLength(0);
    });

    test('keeps stylesheets shared between old and new pages', async () => {
      const link = addServerLink('/shared.css');
      const style = addServerStyle('.shared { margin: 0 }');
      st.readServerStyles();

      await st.transitionStyles(ROUTE, [extStyle('/shared.css'), inlineStyle('.shared { margin: 0 }')]);

      const links = getLinks();
      const styles = getStyles();
      expect(links).toHaveLength(1);
      expect(styles).toHaveLength(1);
      // Same DOM nodes, not recreated
      expect(links[0]).toBe(link);
      expect(styles[0]).toBe(style);
    });

    test('handles mixed add/remove/keep in one transition', async () => {
      addServerLink('/keep.css');
      addServerLink('/remove.css');
      addServerStyle('.keep { color: red }');
      addServerStyle('.remove { color: blue }');
      st.readServerStyles();

      const cleanup = await st.transitionStyles(ROUTE, [
        extStyle('/keep.css'),
        extStyle('/add.css'),
        inlineStyle('.keep { color: red }'),
        inlineStyle('.add { color: green }'),
      ]);
      cleanup();

      const links = getLinks();
      const styles = getStyles();
      expect(links).toHaveLength(2);
      expect(styles).toHaveLength(2);
      expect(links.map(l => new URL(l.href).pathname).sort()).toEqual(['/add.css', '/keep.css']);
      expect(styles.map(s => s.innerHTML).sort()).toEqual(['.add { color: green }', '.keep { color: red }']);
    });

    test('sets rel="stylesheet" on new link elements', async () => {
      st.readServerStyles();
      await st.transitionStyles(ROUTE, [extStyle('/styled.css')]);

      const node = getLinks()[0]!;
      expect(node.rel).toBe('stylesheet');
      expect(node.href).toContain('/styled.css');
    });

    test('sets type and media on new inline style elements', async () => {
      st.readServerStyles();
      await st.transitionStyles(ROUTE, [inlineStyle('.foo {}', { type: 'text/css', media: 'screen' })]);

      const style = getStyles()[0]!;
      expect(style.innerHTML).toBe('.foo {}');
      expect(style.getAttribute('type')).toBe('text/css');
      expect(style.getAttribute('media')).toBe('screen');
    });
  });

  describe('sequential transitions', () => {
    test('correctly diffs across multiple transitions', async () => {
      addServerLink('/a.css');
      st.readServerStyles();

      // Page 2: replace /a with /b
      (await st.transitionStyles(ROUTE, [extStyle('/b.css')]))();
      expect(getLinks().map(l => new URL(l.href).pathname)).toEqual(['/b.css']);

      // Page 3: keep /b, add /c
      (await st.transitionStyles(ROUTE, [extStyle('/b.css'), extStyle('/c.css')]))();
      expect(getLinks().map(l => new URL(l.href).pathname).sort()).toEqual(['/b.css', '/c.css']);

      // Page 4: remove all
      (await st.transitionStyles(ROUTE, []))();
      expect(getLinks()).toHaveLength(0);
    });
  });

  describe('URL normalization', () => {
    test('matches relative href against absolute server-rendered href', async () => {
      addServerLink('/styles.css');
      st.readServerStyles();

      // Server renders absolute URLs; stylesheets use relative paths
      await st.transitionStyles(ROUTE, [extStyle('/styles.css')]);
      expect(getLinks()).toHaveLength(1);
    });

    test('deduplicates same-origin URLs with different forms', async () => {
      addServerLink('/styles.css');
      st.readServerStyles();

      await st.transitionStyles(ROUTE, [extStyle(BASE + '/styles.css')]);
      expect(getLinks()).toHaveLength(1);
    });
  });
});
