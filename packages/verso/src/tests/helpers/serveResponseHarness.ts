import vm from "node:vm";
import {JSDOM} from "jsdom";
import {VERSO_PIPE_NAME} from "../../core/common/VersoPipe";
import {compose} from "../../vendor/hattip/compose";
import type {AdapterRequestContext} from "../../vendor/hattip/core";
import {serveResponse} from "../../core/server/serveResponse";
import {Resolver} from "../../core/common/resolver";
import {runWithServerRLS} from "../../core/common/RequestLocalStorage";
import {fillServerSettings, type RoutesMap, type ServerSettings} from "../../core/config";
import {delay} from "../util/promise";
import type {MiddlewareDefinition} from "../../core/common/handler/Middleware";
import type {RouteHandlerDefinition, RouteHandlerType} from "../../core/common/handler/RouteHandler";
import type {ClientManifest, Serve} from "@verso-js/contract";

export type AnyHandlerDefinition = RouteHandlerDefinition<RouteHandlerType, any, any>;

export type HandlerArg = AnyHandlerDefinition | Record<string, AnyHandlerDefinition>;

export type RunRouteOpts = {
  globalMiddleware?: MiddlewareDefinition[];
  settings?: Partial<ServerSettings>;
  loopback?: Serve;
  manifest?: ClientManifest | null;
};

const throwingLoopback: Serve = async () => {
  throw new Error("[serveResponseHarness] loopback fetch not configured for this test");
};

function isSingleDefinition(arg: HandlerArg): arg is AnyHandlerDefinition {
  return typeof (arg as AnyHandlerDefinition).init === "function";
}

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

  // serveResponse does not use allowedHosts, but fillServerSettings rejects an empty list
  const settings = fillServerSettings({allowedHosts: ["localhost"], ...opts.settings});

  const composed = compose(
    serveResponse({
      resolver,
      manifest: opts.manifest ?? null, // null is the dev value
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

export async function responseBodyAsString(response: Response): Promise<string> {
  return await response.text();
}

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
    // if the timer wins, the pending read still records its chunk when it arrives
    async raceOpen(ms: number): Promise<"open" | "progressed"> {
      return Promise.race([
        readOne().then(() => "progressed" as const),
        delay(ms).then(() => "open" as const),
      ]);
    },
  };
}

export async function collectChunks(response: Response): Promise<string[]> {
  const sr = streamReader(response);
  await sr.readAll();
  return sr.chunks;
}

export type PipeCall = {fn: string; args: unknown[]};

// `offset` is the index of the event's <script> tag in the source HTML
export type PipeEvent =
  | {kind: "call"; fn: string; args: unknown[]; offset: number}
  | {kind: "data"; key: string; value: unknown; offset: number};

// Runs each inline <script> in a vm sandbox where window.__versoPipe records
// the calls and data writes.
function replayPipeScripts(html: string): PipeEvent[] {
  const events: PipeEvent[] = [];
  let currentOffset = -1;

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

  // the no-op setter keeps the recorder when the pipe init script reassigns it
  const sandboxWindow: Record<string, unknown> = {};
  Object.defineProperty(sandboxWindow, VERSO_PIPE_NAME, {
    configurable: true,
    get: () => recorder,
    set: () => {},
  });
  const context = vm.createContext({window: sandboxWindow});

  const doc = parseHtml(html);
  // the indexOf cursor is safe because pipe payloads escape every "<"
  let cursor = 0;
  for (const script of doc.querySelectorAll("script")) {
    currentOffset = html.indexOf("<script", cursor);
    cursor = currentOffset + 1;
    if (script.src) continue;
    try {
      vm.runInContext(script.textContent ?? "", context, {timeout: 1000});
    } catch {
      // not a pipe script, or a partial script from a mid-stream chunk
    }
  }
  return events;
}

export function findPipeEvents(html: string): PipeEvent[] {
  return replayPipeScripts(html);
}

export function findPipeCalls(html: string): PipeCall[] {
  return replayPipeScripts(html)
    .filter((e): e is Extract<PipeEvent, {kind: "call"}> => e.kind === "call")
    .map(({fn, args}) => ({fn, args}));
}

export function findPipeValues(html: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const e of replayPipeScripts(html)) {
    if (e.kind === "data") data[e.key] = e.value;
  }
  return data;
}

export function findPipeValue(html: string, key: string): unknown {
  return findPipeValues(html)[key];
}

export function parseHtml(body: string): Document {
  return new JSDOM(body).window.document;
}
