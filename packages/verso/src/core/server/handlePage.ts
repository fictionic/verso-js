import {Fetch} from "../common/fetch/Fetch";
import {FETCH_CACHE_KEY, FN_ABORT_HYDRATION, FN_HYDRATE_ROOTS_UP_TO, FN_RECEIVE_LATE_DATA_ARRIVAL, VersoPipe} from "../common/VersoPipe";
import type {Script, StandardizedPage} from "../common/handler/Page";
import {writeBody} from "./writeBody";
import {writeHeader} from "./writeHeader";
import {PAGE_HEADER_SCRIPT_ELEMENT_ATTR} from "../common/constants";
import type {ServerSettings} from "../../build/config";
import {getElapsedRequestTime} from "./clock";

const encoder = new TextEncoder();

export function handlePage(page: StandardizedPage, { renderTimeout }: ServerSettings): ReadableStream {
  const { readable, writable } = new TransformStream<Uint8Array>();

  const writer = writable.getWriter();
  const { write, flush } = buffered(writer);

  // for transporting data to the client over the http response
  const writeablePipe = VersoPipe.writer(write);

  // for waiting until all server-side api calls resolve, even ones that don't block render
  const lateArrivalsDfd = Promise.withResolvers<void>();

  async function writePage() {
    write(`<!DOCTYPE html><html lang="en"><head>`);
    writeHeader(page, write);
    write(`</head>`);
    const bodyClasses = await page.getBodyClasses();
    write(`<body class="${bodyClasses.join(' ')}">`);
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

    const elapsedTime = getElapsedRequestTime();
    const remainingTime = Math.max(0, renderTimeout - elapsedTime);

    const abortController = new AbortController();

    const abortTimeout = setTimeout(() => {
      abortController.abort();
      if (haveBootstrapped) {
        writeablePipe.callFn(FN_ABORT_HYDRATION, []);
      }
    }, remainingTime);

    const abortSignal = abortController.signal;

    await writeBody(page, write, onRoot, onTheFold, abortSignal);

    if (!haveBootstrapped) {
      // if TheFold wasn't declared, then it's after the last root
      onTheFold(lastRootIndex + 1);
    }

    await finish(abortSignal);
    clearTimeout(abortTimeout);
  };

  function hydrateRootsUpTo(index: number) {
    writeablePipe.callFn(FN_HYDRATE_ROOTS_UP_TO, [index]);
  }

  function bootstrapClient(theFoldIndex: number) {
    const fetchCache = Fetch.getCache().server().dehydrate();
    writeablePipe.writeValue(FETCH_CACHE_KEY, fetchCache);
    for (const script of [...page.getSystemScripts(), ...page.getScripts()]) {
      write(renderScript(script));
    }
    hydrateRootsUpTo(theFoldIndex - 1);
    flush();
  }

  async function setupLateArrivals(): Promise<void> {
    const pending = Fetch.getCache().server().getPending();
    if (pending.length === 0) return Promise.resolve();
    await Promise.allSettled(
      pending.map(async ({ request, promise }) => {
        const response = await promise;
        writeablePipe.callFn(FN_RECEIVE_LATE_DATA_ARRIVAL, [request, response]);
        flush();
      }));
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
    console.error("unexpected error writing page", err);
    writable.close();
  });
  return readable;

};


function renderScript(script: Script): string {
  const type = script.type ? ` type="${script.type}"` : '';
  const async = script.async ? ' async' : '';
  const defer = script.defer ? ' defer' : '';
  if ('content' in script) {
    return `<script ${PAGE_HEADER_SCRIPT_ELEMENT_ATTR}${type}>${script.content}</script>\n`;
  }
  return `<script ${PAGE_HEADER_SCRIPT_ELEMENT_ATTR}${async}${defer}${type} src="${script.src}"></script>\n`;
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

