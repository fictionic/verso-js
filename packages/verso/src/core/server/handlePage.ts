import {Fetch} from "../common/fetch/Fetch";
import {FETCH_CACHE_KEY, FN_ABORT_HYDRATION, FN_HYDRATE_ROOTS_UP_TO, FN_RECEIVE_LATE_DATA_ARRIVAL, VersoPipe} from "../common/VersoPipe";
import {getScriptAttrs, type Script, type StandardizedPage} from "../common/handler/Page";
import {writeBody} from "./writeBody";
import {renderOpenTag, writeHeader} from "./writeHeader";
import type {ServerSettings} from "../../build/config";
import {getElapsedRequestTime} from "./clock";
import type {CacheableRequest, CachedResponse} from "../common/fetch/cache";
import type {RouteResponse} from "./RouteResponder";

const encoder = new TextEncoder();

export function handlePage(page: StandardizedPage, { renderTimeout }: ServerSettings): RouteResponse {
  const { readable, writable } = new TransformStream<Uint8Array>();

  const writer = writable.getWriter();
  const { write, flush } = buffered(writer);

  // for transporting data to the client over the http response
  const writeablePipe = VersoPipe.writer(write);

  // for waiting until all server-side api calls resolve, even ones that don't block render
  const lateArrivalsDfd = Promise.withResolvers<void>();

  async function writePage() {
    write(`<!DOCTYPE html><html lang="en"><head>`);
    await writeHeader(page, write);
    write(`</head>`);
    flush(); // initiate preloads asap
    write(await renderBodyOpen());

    let haveBootstrapped = false;

    let lastRootIndex = 0;
    const onRoot = (index: number) => {
      if (haveBootstrapped) {
        hydrateRootsUpTo(index);
        flush();
      }
      lastRootIndex = index;
    };

    const onTheFold = async (index: number) => {
      if (haveBootstrapped) {
        console.warn(`writePage: unexpected additional TheFold at index ${index}`);
        return;
      }
      await bootstrapClient(index);
      lateArrivalsDfd.resolve(setupLateArrivals());
      haveBootstrapped = true;
    };

    const abortController = new AbortController();

    function abortHydration() {
      writeablePipe.callFn(FN_ABORT_HYDRATION, []);
    }

    const elapsedTime = getElapsedRequestTime();
    const remainingTime = Math.max(0, renderTimeout - elapsedTime);

    const abortTimeout = setTimeout(() => {
      abortController.abort();
      if (haveBootstrapped) {
        abortHydration();
      }
    }, remainingTime);

    const abortSignal = abortController.signal;

    await writeBody(page, write, onRoot, onTheFold, abortSignal);

    if (!haveBootstrapped) {
      // if TheFold wasn't declared, then it's after the last root
      await onTheFold(lastRootIndex + 1);
    }

    await finish(abortSignal);
    clearTimeout(abortTimeout);
  }

  async function renderBodyOpen() {
    const bodyClasses = await page.getBodyClasses();
    const bodyAttrs = bodyClasses.length ? ` class="${bodyClasses.join(' ')}"` : '';
    return `<body${bodyAttrs}>`;
  }

  function hydrateRootsUpTo(index: number) {
    writeablePipe.callFn(FN_HYDRATE_ROOTS_UP_TO, [index]);
  }

  async function bootstrapClient(theFoldIndex: number) {
    const fetchCache = Fetch.getCache().server().dehydrate();
    writeablePipe.writeValue(FETCH_CACHE_KEY, fetchCache);
    for (const script of [...await page.getSystemScripts(), ...page.getScripts()]) {
      write(renderScript(script));
    }
    hydrateRootsUpTo(theFoldIndex - 1);
    flush();
  }

  async function setupLateArrivals(): Promise<void> {
    const pending = Fetch.getCache().server().getPending();
    if (pending.length === 0) return Promise.resolve();
    await Promise.allSettled(
      pending.map(async ({ request, responsePromise }) => {
        const response = await responsePromise;
        receiveLateArrival(request, response);
        flush();
      })
    );
  }

  function receiveLateArrival(request: CacheableRequest, response: CachedResponse) {
    writeablePipe.callFn(FN_RECEIVE_LATE_DATA_ARRIVAL, [request, response]);
  }

  async function finish(abortSignal: AbortSignal) {
    await Promise.race([
      lateArrivalsDfd.promise,
      new Promise((resolve) => abortSignal.addEventListener('abort', resolve)),
    ]);
    write('</body></html>');
    flush();
    writer.close();
  }

  writePage().catch((err) => {
    console.error("[verso] unexpected error writing page", err);
    writable.close();
  });

  return {
   getContentType: () => 'text/html; charset=utf-8',
   getBody: () => readable,
  };
};

function renderScript(script: Script): string {
  const text = 'text' in script ? script.text : '';
  return `${renderOpenTag('script', getScriptAttrs(script))}${text}</script>\n`;
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

