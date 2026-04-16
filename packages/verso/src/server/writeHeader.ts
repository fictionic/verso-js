import {PAGE_HEADER_LINK_ELEMENT_ATTR, PAGE_HEADER_STYLE_ELEMENT_ATTR} from "../core/constants";
import {getMetaTagAttrs} from "../core/handler/Page";
import type {StandardizedPage, Stylesheet, LinkTag, MetaTag, BaseTag} from "../core/handler/Page";

export function writeHeader(page: StandardizedPage, write: (html: string) => void) {
  write('<meta charset="utf-8" />');
  write(renderBaseTag(page.getBase()));
  write(renderMetaTags(page.getMetaTags()));
  write(`<title>${page.getTitle()}</title>`);
  write(renderLinkTags(page.getSystemLinkTags()));
  write(renderLinkTags(page.getLinkTags()));
  write(renderStylesheets(page.getSystemStylesheets()));
  write(renderStylesheets(page.getStylesheets()));
}

function renderBaseTag(base: BaseTag | null): string {
  if (!base) return '';
  let s = '<base';
  if (base.href) s += ` href="${base.href}"`;
  if (base.target) s += ` target="${base.target}"`;
  return s + '>';
}

function renderMetaTags(tags: MetaTag[]): string {
  return tags.map(t => {
    const attrs = Object.entries(getMetaTagAttrs(t)).map(([k, v]) => ` ${k}="${v}"`).join('');
    const tag = `<meta${attrs}>`;
    return t.noscript ? `<noscript>${tag}</noscript>` : tag;
  }).join('\n');
}

function renderLinkTags(tags: LinkTag[]): string {
  return tags.map(t => {
    let s = `<link ${PAGE_HEADER_LINK_ELEMENT_ATTR} rel="${t.rel}" href="${t.href}"`;
    if (t.as) s += ` as="${t.as}"`;
    if (t.crossorigin) s += ` crossorigin="${t.crossorigin}"`;
    if (t.type) s += ` type="${t.type}"`;
    return s + '>';
  }).join('\n');
}

function renderStylesheets(stylesheets: Stylesheet[]): string {
  return stylesheets.map(s => {
    const dataAttr = s.dataAttr
      ? ` ${s.dataAttr.name}${s.dataAttr.value != null ? `="${s.dataAttr.value}"` : ''}`
      : '';
    if ('href' in s) {
      return `<link ${PAGE_HEADER_STYLE_ELEMENT_ATTR} rel="stylesheet" href="${s.href}"${dataAttr}>`;
    }
    const type = s.type ?? 'text/css';
    const media = s.media ?? '';
    const mediaAttr = media ? ` media="${media}"` : '';
    return `<style ${PAGE_HEADER_STYLE_ELEMENT_ATTR} type="${type}"${mediaAttr}${dataAttr}>${s.text}</style>`;
  }).join('\n');
}

