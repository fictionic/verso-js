import type {StandardizedPage, Stylesheet} from "../core/handler/Page";

export function writeHeader(page: StandardizedPage, write: (html: string) => void) {
  write(`<title>${page.getTitle()}</title>`);
  write(`${renderStylesheets(page.getSystemStylesheets())}`);
  write(`${renderStylesheets(page.getStylesheets())}`);
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

