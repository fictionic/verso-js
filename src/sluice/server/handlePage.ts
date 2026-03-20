import type { Page, PageStyle } from '../Page';
import { startRequest } from '../util/requestLocal';
import { RequestContext } from './RequestContext';
import { handleBody } from './handleBody';
import { FETCH_CACHE_KEY, FN_RECEIVE_LATE_DATA_ARRIVAL, FN_HYDRATE_ROOTS_UP_TO, SluicePipe } from '../core/SluicePipe';
import { Fetch } from '../core/fetch/Fetch';

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

export function handlePage(
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
    Fetch.init({
      urlPrefix: urlPrefix ?? null,
    });
    run().catch((err) => {
      console.error('[handlePage]', err);
      writer.abort(err);
    });
  });

  async function run() {
    const page = new PageClass();
    page.createStores();
    const lateArrivalsDfd = Promise.withResolvers<void>();

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
        console.warn(`handlePage: unexpected additional TheFold at index ${index}`);
        return;
      }
      bootstrapClient(index);
      lateArrivalsDfd.resolve(setupLateArrivals());
      haveBootstrapped = true;
    };

    const abort = AbortSignal.timeout(renderTimeout);
    await handleBody(page, write, onRoot, onTheFold, abort);

    if (!haveBootstrapped) {
      // if TheFold wasn't declared, then it's after the last root
      onTheFold(lastRootIndex + 1);
    }

    await lateArrivalsDfd.promise;
    write('</body></html>');
    flush();
    writer.close();
  }

  function hydrateRootsUpTo(index: number) {
    writeablePipe.callFn(FN_HYDRATE_ROOTS_UP_TO, [index]);
  }

  function bootstrapClient(theFoldIndex: number) {
    const fetchCache = Fetch.getCache().server().dehydrate();
    console.log('[handlePage:debug] dehydrated cache keys:', Object.keys(fetchCache), 'entries:', Object.entries(fetchCache).map(([k, v]) => `${k}: response=${!!v.response}, requesters=${v.requesters}`));
    writeablePipe.writeValue(FETCH_CACHE_KEY, fetchCache);
    write(`<script async type="module" src="${clientBundleUrl}"></script>\n`);
    hydrateRootsUpTo(theFoldIndex - 1);
    flush();
  }

  function setupLateArrivals(): Promise<void> {
    const pending = Fetch.getCache().server().getPending();
    if (pending.length === 0) return Promise.resolve();

    return Promise.allSettled(
      pending.map(({ url, promise }) => {
        return promise.then((response) => {
          writeablePipe.callFn(FN_RECEIVE_LATE_DATA_ARRIVAL, [url, response]);
          flush();
        })
      }
    )).then(() => {});
  }

  return readable;
}
