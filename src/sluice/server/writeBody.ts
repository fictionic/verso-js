import { renderToString } from 'react-dom/server';
import { scheduleRender } from '../core/components/Root';
import type { Page } from '../Page';
import {TOKEN, tokenizeElements, type PageElementToken} from '../core/elementTokenizer';
import type {RootContainerElementType} from '../core/components/RootContainer';
import {PAGE_ELEMENT_TOKEN_ID_ATTR, PAGE_ROOT_ELEMENT_ATTR} from '../constants';

const TOKEN_STATUS = {
  PENDING: 'PENDING',
  RENDERED: 'RENDERED',
  FAILED_RENDERING: 'FAILED_RENDERING',
  WRITTEN: 'WRITTEN',
} as const;

type RenderedToken = {
  token: PageElementToken;
  status: typeof TOKEN_STATUS[keyof typeof TOKEN_STATUS];
  html: string | null;
};

export async function writeBody(
  page: Page,
  write: (html: string) => void,
  onRoot: (index: number) => void,
  onTheFold: (index: number) => void,
  abort: AbortSignal,
) {
  const elements = page.getElements();
  const tokens = tokenizeElements(elements);
  const renderedTokens: RenderedToken[] = [];

  let next = 0;
  // TODO: is there an easy way to avoid defining this logic above the rendering?
  const writeRenderedTokens = () => {
    let buffer = ''
    let i = next;
    for(; i < renderedTokens.length; i++) {
      const slot = renderedTokens[i]!;
      if (slot.status === TOKEN_STATUS.PENDING) {
        // have to go in order. we're blocked until the next one is ready
        break;
      } else if (slot.status === TOKEN_STATUS.WRITTEN) {
        // this shouldn't happen. runtime invariant.
        console.error("[renderBody] elements rendering out of order!");
        continue;
      } else if (slot.status === TOKEN_STATUS.FAILED_RENDERING) {
        // nothing to render. just keep moving
        continue;
      } else if (slot.status === TOKEN_STATUS.RENDERED) {
        // got one!
        if (slot.token.type === TOKEN.THE_FOLD) {
          onTheFold(i); // bootstrap the client
          slot.status = TOKEN_STATUS.WRITTEN;
          continue;
        }
        if (slot.html) {
          buffer += slot.html;
          slot.status = TOKEN_STATUS.WRITTEN;
          slot.html = null; // GC
        }
      } else {
        slot.status satisfies never;
      }
    }
    if (buffer.length > 0) {
      write(buffer);
      onRoot(i - 1); // wake all roots up to the last one we wrote
    }
    next = i;
  };

  const rootPromises: Promise<unknown>[] = [];

  tokens.forEach((token, i) => {
    const rendered: RenderedToken = {
      token,
      status: TOKEN_STATUS.PENDING,
      html: null,
    };
    renderedTokens.push(rendered);
    switch (token.type) {
      case TOKEN.CONTAINER_OPEN:
        rendered.status = TOKEN_STATUS.RENDERED;
        rendered.html = renderContainerOpen(token.element, i);
        break;
      case TOKEN.CONTAINER_CLOSE:
        rendered.status = TOKEN_STATUS.RENDERED;
        rendered.html = renderContainerClose();
        break;
      case TOKEN.THE_FOLD:
        rendered.status = TOKEN_STATUS.RENDERED;
        // the fold is just a control element; nothing to render
        break;
      case TOKEN.ROOT:
        rootPromises.push(scheduleRender(token.element).then((resolved) => {
          try {
            const rootInnerHTML = renderToString(resolved);
            rendered.html = `<div ${PAGE_ELEMENT_TOKEN_ID_ATTR}="${i}" ${PAGE_ROOT_ELEMENT_ATTR}>${rootInnerHTML}</div>\n`;
            rendered.status = TOKEN_STATUS.RENDERED;
          } catch (err) {
            console.error(`[renderBody] renderToString failed for element ${i}`, err);
            rendered.status = TOKEN_STATUS.FAILED_RENDERING;
          }
          writeRenderedTokens();
        }));
        break;
      default:
        token satisfies never;
    }
  });

  writeRenderedTokens(); // render any synchronous elements right away

  abort.addEventListener('abort', () => {
    // if we take too long, we mark all pending roots as failed,
    // write them out, and return control to the caller
    for (const slot of renderedTokens) {
      if (slot.status === TOKEN_STATUS.PENDING) {
        slot.status = TOKEN_STATUS.FAILED_RENDERING;
      }
    }
    writeRenderedTokens();
  });

  await Promise.race([
    Promise.all(rootPromises),
    new Promise<void>(resolve => abort.addEventListener('abort', () => resolve())),
  ]);
}

function renderContainerOpen(element: RootContainerElementType, index: number): string {
  const { props } = element;
  let attrs = `${PAGE_ELEMENT_TOKEN_ID_ATTR}="${index}"`;
  if (props.id) attrs += ` id="${props.id}"`;
  if (props.className) attrs += ` class="${props.className}"`;
  if (props.style) attrs += ` style="${props.style}"`;
  return `<div${attrs}>\n`;
}

function renderContainerClose(): string {
  return `</div>\n`;
}

