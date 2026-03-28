import {Fetch} from "../core/fetch/Fetch";
import {FETCH_CACHE_KEY, FN_HYDRATE_ROOTS_UP_TO, FN_RECEIVE_LATE_DATA_ARRIVAL, VersoPipe} from "../core/VersoPipe";
import type {Script, StandardizedPage} from "../core/handler/Page";
import {writeBody} from "./writeBody";
import {writeHeader} from "./writeHeader";

const encoder = new TextEncoder();

interface StreamOpts {
  renderTimeout: number;
}

export function makeStreamer(page: StandardizedPage, { renderTimeout }: StreamOpts) {

  const { readable, writable } = new TransformStream<Uint8Array>();

  function stream(): ReadableStream {
    writePage().catch((err) => {
      console.error("unexpected error writing page", err);
      writable.close();
    });
    return readable;
  }

  const writer = writable.getWriter();
  const { write, flush } = buffered(writer);

  // for transporting data to the client over the http response
  const writeablePipe = VersoPipe.writer(write);

  // for waiting until all server-side api calls resolve, even ones that don't block render
  const lateArrivalsDfd = Promise.withResolvers<void>();

  async function writePage() {
    write(`<!DOCTYPE html><html lang="en"><head>`);
    writeHeader(page, write);
    write(`</head><body>`);
    flush();

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
        console.warn(`writePage: unexpected additional TheFold at index ${index}`);
        return;
      }
      bootstrapClient(index);
      lateArrivalsDfd.resolve(setupLateArrivals());
      haveBootstrapped = true;
    };

    const abort = AbortSignal.timeout(renderTimeout);
    await writeBody(page, write, onRoot, onTheFold, abort);

    if (!haveBootstrapped) {
      // if TheFold wasn't declared, then it's after the last root
      onTheFold(lastRootIndex + 1);
    }

    finish();
  };

  function hydrateRootsUpTo(index: number) {
    writeablePipe.callFn(FN_HYDRATE_ROOTS_UP_TO, [index]);
  }

  function bootstrapClient(theFoldIndex: number) {
    const fetchCache = Fetch.getCache().server().dehydrate();
    console.log('[handlePage:debug] dehydrated cache keys:', Object.keys(fetchCache), 'entries:', Object.entries(fetchCache).map(([k, v]) => `${k}: response=${!!v.response}, requesters=${v.requesters}`));
    writeablePipe.writeValue(FETCH_CACHE_KEY, fetchCache);
    for (const script of [...page.getSystemScripts(), ...page.getScripts()]) {
      write(renderScript(script));
    }
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
      })).then(() => {});
  }

  async function finish() {
    await lateArrivalsDfd.promise;
    write('</body></html>');
    flush();
    writer.close();
  }

  return {
    stream,
  };
};


function renderScript(script: Script): string {
  const type = script.type ? ` type="${script.type}"` : '';
  const async = script.async ? ' async' : '';
  const defer = script.defer ? ' defer' : '';
  if (script.content) {
    return `<script${type}>${script.content}</script>\n`;
  }
  if (script.src) {
    return `<script${async}${defer}${type} src="${script.src}"></script>\n`;
  }
  return '';
}

function buffered(writer: WritableStreamDefaultWriter) {
  let writeBuffer = '';
  function write(chunk: string) {
    writeBuffer += chunk;
  }
  function flush() {
    if (writeBuffer.length === 0) return;
    writer.write(encoder.encode(writeBuffer));
    writeBuffer = '';
  }
  return { write, flush };
}
