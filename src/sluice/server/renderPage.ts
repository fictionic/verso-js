import { getCache, dehydrateCache, getPendingRequests, setUrlPrefix } from '../core/fetch';
import type { Page, PageStyle } from '../Page';
import { startRequest } from '../util/requestLocal';
import { RequestContext } from './RequestContext';
import { writeBody } from './writeBody';
import { FETCH_CACHE_KEY, FN_RECEIVE_LATE_DATA_ARRIVAL, FN_HYDRATE_ROOTS_UP_TO, SluicePipe } from '../core/SluicePipe';

const encoder = new TextEncoder();

const RENDER_TIMEOUT_MS = 20_000;

function renderStyles(styles: PageStyle[]): string {
  return styles.map(s =>
    typeof s === 'string'
      ? `<style>${s}</style>`
      : `<link rel="stylesheet" href="${s.href}">`
  ).join('\n');
}

interface Options {
  clientBundleUrl: string,
  renderTimeout?: number;
  urlPrefix?: string;
};

export function renderPage(
  req: Request,
  PageClass: new () => Page,
  {
    clientBundleUrl,
    renderTimeout = RENDER_TIMEOUT_MS,
    urlPrefix,
  }: Options,
): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  let writeBuffer = '';
  function write(chunk: string) {
    writeBuffer += chunk;
  }

  function flush() {
    if (writeBuffer.length === 0) return;
    writer.write(encoder.encode(writeBuffer));
    writeBuffer = '';
  }

  const writeablePipe = SluicePipe.writer(write);

  startRequest(() => {
    new RequestContext(req).register();
    if (urlPrefix) setUrlPrefix(urlPrefix);
    run().catch((err) => {
      console.error('[renderPage]', err);
      writer.abort(err);
    });
  });

  async function run() {
    const page = new PageClass();
    page.createStores();
    let lateArrivalsPromise: Promise<void> | null = null;

    write(`<!DOCTYPE html><html lang="en"><head>`);
    write(`<title>${page.getTitle()}</title>`);
    write(`${renderStyles(page.getStyles())}`);
    write(`</head><body>`);
    flush();

    // TODO: probably need to use RLS for these
    let haveBootstrapped = false;

    let lastRootIndex = 0;
    const onRoot = (index: number) => {
      if (haveBootstrapped) {
        hydrateRootsUpTo(index);
        flush();
      }
      lastRootIndex = index;
    };

    const onTheFold = (index: number) => {
      if (haveBootstrapped) {
        console.warn(`renderPage: unexpected additional TheFold at index ${index}`);
        return;
      }
      bootstrapClient(index);
      lateArrivalsPromise = setupLateArrivals();
      haveBootstrapped = true;
    };

    const abort = AbortSignal.timeout(renderTimeout);
    await writeBody(page, write, onRoot, onTheFold, abort);

    if (!haveBootstrapped) {
      // if TheFold wasn't declared, then it's after the last root
      onTheFold(lastRootIndex + 1);
    }

    if (lateArrivalsPromise) await lateArrivalsPromise;
    write('</body></html>');
    flush();
    writer.close();
  }

  function hydrateRootsUpTo(index: number) {
    writeablePipe.callFn(FN_HYDRATE_ROOTS_UP_TO, [index]);
  }

  function bootstrapClient(theFoldIndex: number) {
    const fetchCache = dehydrateCache();
    writeablePipe.writeValue(FETCH_CACHE_KEY, fetchCache);
    write(`<script type="module" src="${clientBundleUrl}"></script>\n`);
    hydrateRootsUpTo(theFoldIndex - 1);
    flush();
  }

  function setupLateArrivals(): Promise<void> {
    const pending = getPendingRequests();
    if (pending.length === 0) return Promise.resolve();

    return Promise.allSettled(
      pending.map(({ url, promise }) => {
        promise.then(() => {
          const entry = getCache().get(url);
          if (entry) {
            writeablePipe.callFn(FN_RECEIVE_LATE_DATA_ARRIVAL, [url, entry]);
            flush();
          }
        })
      }
    )).then(() => {});
  }

  return readable;
}
