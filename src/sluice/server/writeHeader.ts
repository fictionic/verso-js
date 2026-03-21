import type {Page, PageStyle} from "../Page";

export function writeHeader(page: Page, stylesheets: string[], write: (html: string) => void) {
  write(`<title>${page.getTitle()}</title>`);
  write(`${renderStyles(page.getStyles())}`);
  stylesheets.forEach(href => {
    write(`<link rel="stylesheet" href="${href}">`);
  });
}

function renderStyles(styles: PageStyle[]): string {
  return styles.map(s =>
    typeof s === 'string'
      ? `<style>${s}</style>`
      : `<link rel="stylesheet" href="${s.href}">`
  ).join('\n');
}

