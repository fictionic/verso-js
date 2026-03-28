import type {StandardizedPage, Stylesheet, LinkTag} from "../core/handler/Page";

export function writeHeader(page: StandardizedPage, write: (html: string) => void) {
  write(`<title>${page.getTitle()}</title>`);
  write(renderStylesheets(page.getSystemStylesheets()));
  write(renderLinkTags(page.getSystemLinkTags()));
  write(renderLinkTags(page.getLinkTags()));
  write(renderStylesheets(page.getStylesheets()));
}

function renderStylesheets(stylesheets: Stylesheet[]): string {
  return stylesheets.map(s => {
    if ('href' in s) {
      return `<link rel="stylesheet" href="${s.href}">`;
    }
    const type = s.type ?? 'text/css';
    const media = s.media ?? '';
    const mediaAttr = media ? ` media="${media}"` : '';
    return `<style type="${type}"${mediaAttr}>${s.text}</style>`;
  }).join('\n');
}

function renderLinkTags(tags: LinkTag[]): string {
  return tags.map(t => {
    let s = `<link rel="${t.rel}" href="${t.href}"`;
    if (t.as) s += ` as="${t.as}"`;
    if (t.crossorigin) s += ` crossorigin="${t.crossorigin}"`;
    if (t.type) s += ` type="${t.type}"`;
    return s + '>';
  }).join('\n');
}

