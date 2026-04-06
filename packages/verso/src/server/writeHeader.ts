import {PAGE_HEADER_LINK_ELEMENT_ATTR, PAGE_HEADER_STYLE_ELEMENT_ATTR} from "../core/constants";
import type {StandardizedPage, Stylesheet, LinkTag} from "../core/handler/Page";

export function writeHeader(page: StandardizedPage, write: (html: string) => void) {
  write(`<title>${page.getTitle()}</title>`);
  write(renderLinkTags(page.getSystemLinkTags()));
  write(renderLinkTags(page.getLinkTags()));
  write(renderStylesheets(page.getSystemStylesheets()));
  write(renderStylesheets(page.getStylesheets()));
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

