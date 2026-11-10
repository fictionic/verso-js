// Integration harness for Suite 1 (`serveResponse`).
//
// `serveResponse` is a hattip `RequestHandler` that turns a `RouteResolution` into a
// `Response`. This harness drives it end-to-end the same way `composeServer`
// does — composing it with the default hattip error/404 handling, building a
// real `Resolver` and `MiddlewareConfig`, and running inside `runWithServerRLS`
// — but without the public-request / bundle-serving / failsafe layers (each of
// those has its own suite). Mock only at boundaries (e.g. native `fetch`).
//
// Suite 1 runs in the **server** pass; do not switch the pass to jsdom. `jsdom`
// is used here purely as an HTML parser library (`parseHtml`), not as the test
// environment.

import vm from "node:vm";
import {JSDOM} from "jsdom";
import {VERSO_PIPE_NAME} from "../../core/common/VersoPipe";
import {compose} from "../../vendor/hattip/compose";
import type {AdapterRequestContext} from "../../vendor/hattip/core";
import {serveResponse} from "../../core/server/serveResponse";
import {Resolver} from "../../core/common/resolver";
import {runWithServerRLS} from "../../core/common/RequestLocalStorage";
import {fillServerSettings, type RoutesMap, type ServerSettings} from "../../build/config";
import {delay} from "../util/promise";
import type {MiddlewareDefinition} from "../../core/common/handler/Middleware";
import type {RouteHandlerDefinition, RouteHandlerType} from "../../core/common/handler/RouteHandler";
import type {ClientManifest, Serve} from "@verso-js/contract";

export type AnyHandlerDefinition = RouteHandlerDefinition<RouteHandlerType, any, any>;

/**
 * A handler argument is either:
 *  - a single `definePage` / `defineEndpoint` result — returned for **every**
 *    route name (single-route convenience), or
 *  - a `{ routeName: definition }` map — looked up by route name (the key in
 *    the `RoutesMap`), matching how `Resolver` keys `getRouteHandler`.
 */
export type HandlerArg = AnyHandlerDefinition | Record<string, AnyHandlerDefinition>;

export type RunRouteOpts = {
  globalMiddleware?: MiddlewareDefinition[];
  settings?: Partial<ServerSettings>;
  /**
   * The `Serve` used for loopback fetch() calls. Defaults to a stub that throws
   * — most tests make no loopback fetches. Inject one for tests that do.
   */
  loopback?: Serve;
  /**
   * The client build manifest. Defaults to `null` (dev — no built bundle, the
   * value `serveResponse` gets in `vite dev`). Pass a manifest to exercise the
   * manifest-through-pipe branch of `bootstrapClient`, which writes it to the
   * pipe under `CLIENT_MANIFEST_KEY`. (`null` skips that write entirely.)
   */
  manifest?: ClientManifest | null;
};

const throwingLoopback: Serve = async () => {
  throw new Error("[serveResponseHarness] loopback fetch not configured for this test");
};

function isSingleDefinition(arg: HandlerArg): arg is AnyHandlerDefinition {
  // A `RouteHandlerDefinition` carries `{ type, init, standardize }`; a map of
  // definitions does not have an `init` field at the top level.
  return typeof (arg as AnyHandlerDefinition).init === "function";
}

/** Dispatch a `Request` through `serveResponse` and return the resulting
 * `Response`.
 *
 * Builds a real `Resolver`, composes `serveResponse` with hattip's default
 * error handling (a thrown directive / `error` resolution surfaces as a 500
 * `Internal Server Error`) and 404 fallback (a `not-found` resolution /
 * passthrough yields hattip's default 404 — status 404, body `Not found`; this
 * is distinct from a resolved directive with no handler attached, where
 * `serveResponse` itself returns the directive's status with a null body), and
 * runs the whole thing inside `runWithServerRLS`.
 *
 * Pass a `request` whose `signal` the test controls for render-abort cases.
 */
export function run(
  request: Request,
  routes: RoutesMap,
  handler: HandlerArg,
  opts: RunRouteOpts = {},
): Promise<Response> {
  const getRouteHandler = isSingleDefinition(handler)
    ? () => handler
    : (name: string) => handler[name] ?? null;

  const resolver = new Resolver(routes, getRouteHandler, opts.globalMiddleware ?? []);

  // `allowedHosts` is unused by `serveResponse` (it belongs to `resolvePublicRequest`,
  // which the harness omits), but `fillServerSettings` rejects an empty list.
  const settings = fillServerSettings({allowedHosts: ["localhost"], ...opts.settings});

  const composed = compose(
    serveResponse({
      resolver,
      manifest: opts.manifest ?? null, // null = dev (no built bundle)
      loopback: opts.loopback ?? throwingLoopback,
      settings,
    }),
  );

  return runWithServerRLS(async () => {
    const ctx: AdapterRequestContext = {
      request,
      ip: "",
      platform: {},
      env: () => undefined,
      passThrough: () => {},
      waitUntil: () => {},
    };
    return composed(ctx);
  });
}

/** Collect the full response body as a string. */
export async function responseBodyAsString(response: Response): Promise<string> {
  return await response.text();
}

/**
 * Incremental reader over a response body's `ReadableStream`. Each `readOne`
 * corresponds to one `writer.write()` (= one `flush()`) on the server, so
 * `chunks` indices line up with flush boundaries. Use this for ordering /
 * interleaved read-write assertions that `responseBodyAsChunks` (a pull-only
 * async iterable) can't express cleanly — e.g. write a chunk, prove it arrives
 * before the next write, then close.
 */
export function streamReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let done = false;
  async function readOne(): Promise<boolean> {
    const r = await reader.read();
    if (r.done) {
      done = true;
      return false;
    }
    if (r.value) chunks.push(decoder.decode(r.value, {stream: true}));
    return true;
  }
  return {
    chunks,
    reader,
    isDone: () => done,
    text: () => chunks.join(""),
    readOne,
    async readUntil(pred: (text: string) => boolean): Promise<void> {
      while (!pred(chunks.join(""))) {
        if (!(await readOne())) return;
      }
    },
    async readAll(): Promise<void> {
      while (await readOne());
    },
    /**
     * Start a read and race it against a timer. Returns "open" if no chunk
     * arrives within `ms` (the stream is blocked); "progressed" if one did. A
     * chunk that arrives later (after a slow root resolves) is still tracked in
     * `chunks` by the read's own continuation, so subsequent `readAll` stays in
     * order.
     */
    async raceOpen(ms: number): Promise<"open" | "progressed"> {
      return Promise.race([
        readOne().then(() => "progressed" as const),
        delay(ms).then(() => "open" as const),
      ]);
    },
  };
}

/** Read a response body to completion, returning the chunks in arrival order. */
export async function collectChunks(response: Response): Promise<string[]> {
  const sr = streamReader(response);
  await sr.readAll();
  return sr.chunks;
}

export type PipeCall = {fn: string; args: unknown[]};

/**
 * A single VersoPipe inline-script event, carrying the byte `offset` of its
 * `<script>` tag within the HTML it was found in. `offset` is what lets ordering
 * tests place a pipe call/value relative to rendered root content (e.g. the fold
 * sandwich: `preRoot < fetchCache-write < postRoot`) without smuggling in a fake
 * landmark or substring-matching the raw `window.__versoPipe...` wire format.
 */
export type PipeEvent =
  | {kind: "call"; fn: string; args: unknown[]; offset: number}
  | {kind: "data"; key: string; value: unknown; offset: number};

/**
 * Replay the VersoPipe inline scripts in rendered body/chunk HTML, returning one
 * `PipeEvent` per call / data write in document (= emission) order, each tagged
 * with the byte offset of its `<script>` tag.
 *
 * `ServerClientPipe` emits two kinds of inline script:
 *
 *   <script>window.__versoPipe.fns.call('<FN_NAME>', <args>)</script>   // a call
 *   <script>window.__versoPipe.data['<KEY>'] = <value></script>         // a data write
 *
 * where `<args>` / `<value>` is `JSON.stringify(...)` with `<`, `>`, `&` escaped
 * to `\uXXXX` (so a real HTML parser sees clean `<script>` boundaries). Rather
 * than re-parse that markup — and re-parse the JSON inside it — we do what the
 * browser does: parse the HTML with jsdom, then execute each inline `<script>`
 * in a `vm` sandbox whose `window.__versoPipe` is a recorder. Calls and data
 * therefore come back as real deserialized JS values, robust to any content
 * inside them (URLs with `]`/`)`, nested objects, escaped `</script>` text).
 *
 * Offsets: we walk a cursor over `<script` occurrences in `html` in lockstep
 * with the document-order `querySelectorAll("script")` iteration (advancing for
 * every script element, including skipped `src` ones, so the cursor stays
 * aligned with the DOM). This is safe because `serialize` replaces every `<` in
 * pipe payloads with a Unicode escape sequence, so no payload ever emits a real
 * `<script` to throw off the cursor.
 *
 * The pipe's own init script reassigns `window.__versoPipe`; a no-op setter
 * keeps our recorder in place across that. Non-pipe inline scripts that throw in
 * the bare sandbox (or a partial one from a mid-stream prefix) are ignored.
 */
function replayPipeScripts(html: string): PipeEvent[] {
  const events: PipeEvent[] = [];
  let currentOffset = -1; // byte offset of the <script> currently executing

  // Data writes (`window.__versoPipe.data['key'] = value`) land on this Proxy's
  // `set` trap, so we capture key/value/offset without the data ever needing a
  // backing store. Calls land on `fns.call`. Both tag the event with the offset
  // of the script that produced it.
  const dataProxy = new Proxy({} as Record<string, unknown>, {
    set: (_target, key, value) => {
      events.push({kind: "data", key: String(key), value, offset: currentOffset});
      return true;
    },
  });
  const recorder = {
    data: dataProxy,
    fns: {
      call: (fn: string, args: unknown[]) =>
        void events.push({kind: "call", fn, args, offset: currentOffset}),
    },
  };

  // The sandbox's only global is `window`. Its `__versoPipe` is fixed to our
  // recorder via a getter; the swallowing setter ignores the init script's
  // `window.__versoPipe = {…}` reassignment so calls/data keep landing on us.
  const sandboxWindow: Record<string, unknown> = {};
  Object.defineProperty(sandboxWindow, VERSO_PIPE_NAME, {
    configurable: true,
    get: () => recorder,
    set: () => {},
  });
  const context = vm.createContext({window: sandboxWindow});

  const doc = parseHtml(html);
  let cursor = 0;
  for (const script of doc.querySelectorAll("script")) {
    currentOffset = html.indexOf("<script", cursor);
    cursor = currentOffset + 1;
    if (script.src) continue; // external bundle/entry — not an inline pipe script
    try {
      vm.runInContext(script.textContent ?? "", context, {timeout: 1000});
    } catch {
      // Non-pipe inline script (or a partial one from a mid-stream prefix):
      // it can't reference anything but `window`, so it just throws — skip it.
    }
  }
  return events;
}

/**
 * Extract all VersoPipe inline-script events (calls and data writes) from
 * rendered body/chunk HTML, in document (= emission) order, each carrying the
 * byte offset of its `<script>` tag. Use this for ordering assertions that mix
 * pipe events with rendered root content. See `replayPipeScripts`.
 */
export function findPipeEvents(html: string): PipeEvent[] {
  return replayPipeScripts(html);
}

/**
 * Extract VersoPipe function calls from rendered body/chunk HTML, one
 * `{ fn, args }` per call in document (= emission) order. See `replayPipeScripts`.
 */
export function findPipeCalls(html: string): PipeCall[] {
  return replayPipeScripts(html)
    .filter((e): e is Extract<PipeEvent, {kind: "call"}> => e.kind === "call")
    .map(({fn, args}) => ({fn, args}));
}

/**
 * Extract all VersoPipe **data** writes (`window.__versoPipe.data[key] = value`)
 * from rendered body/chunk HTML, as a `{ key: value }` map of real deserialized
 * values (last write wins). This is how the client manifest (`clientManifest`),
 * the dehydrated fetch cache (`fetchCache`), and request data ride the pipe —
 * they are *not* `fns.call`s, so `findPipeCalls` does not see them. See
 * `replayPipeScripts`.
 */
export function findPipeValues(html: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const e of replayPipeScripts(html)) {
    if (e.kind === "data") data[e.key] = e.value;
  }
  return data;
}

/**
 * Convenience: the single VersoPipe data value written under `key`, or
 * `undefined` if no write to that key appears. See `findPipeValues`.
 */
export function findPipeValue(html: string, key: string): unknown {
  return findPipeValues(html)[key];
}

/** Parse an HTML string into a `Document` (jsdom, used as a parser only). */
export function parseHtml(body: string): Document {
  return new JSDOM(body).window.document;
}
