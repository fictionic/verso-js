import type {Page, Stylesheet} from "../Page";

export function writeHeader(page: Page, stylesheets: string[], write: (html: string) => void) {
  write(`<title>${page.getTitle()}</title>`);
  write(`${renderStylesheets(page.getHeadStylesheets())}`);
  stylesheets.forEach(href => {
    write(`<link rel="stylesheet" href="${href}">`);
  });
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

