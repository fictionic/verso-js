// Suite 1, Section 2 — Page rendering.
//
// Pages-only wire-protocol assertions on what `serveResponse` -> `handlePage`
// emits: rendered HTML (document shape, roots, containers, scripts, body
// classes), streaming chunk order, and VersoPipe-call placement (bootstrap at
// the fold, hydrateRootsUpTo, abortHydration, late arrivals). HTML content is
// inspected through `parseHtml` (jsdom-as-parser) or byte-offset comparison;
// streaming order is inspected by consuming the body chunk-by-chunk and
// classifying chunks with `findPipeCalls` / `findPipeValue` / `findPipeEvents`.
//
// Server pass only (the harness runs server-path code: `runWithServerRLS`,
// `renderToString`), hence the `.server.test.tsx` suffix — see the 2b entry in
// _progress.md for the same rename rationale.

import type {FC, ReactElement} from "react";
import {describe, test, expect, vi, beforeEach} from "vitest";
import {definePage} from "../core/common/handler/Page";
import {Root, makeRootComponent} from "../core/common/components/Root";
import {RootContainer} from "../core/common/components/RootContainer";
import {TheFold} from "../core/common/components/TheFold";
import {Fetch} from "../core/common/fetch/Fetch";
import {nativeFetch} from "../core/common/fetch/nativeFetch";
import {
  CLIENT_MANIFEST_KEY,
  FETCH_CACHE_KEY,
  FN_ABORT_HYDRATION,
  FN_HYDRATE_ROOTS_UP_TO,
  FN_RECEIVE_LATE_DATA_ARRIVAL,
  FN_SIGNAL_END_OF_DATA,
  FN_SIGNAL_ROOTS_COMPLETE,
} from "../core/common/VersoPipe";
import type {RoutesMap} from "../build/config";
import type {ClientManifest} from "@verso-js/contract";
import {
  collectChunks,
  findPipeCalls,
  findPipeEvents,
  findPipeValue,
  parseHtml,
  responseBodyAsString,
  run,
  streamReader,
  type RunRouteOpts,
} from "./helpers/serveResponseHarness";
import {delay} from "./util/promise";

// `nativeFetch.ts` captures `globalThis.fetch` at import time, so a `vi.stubGlobal`
// after import is silently bypassed; the one-line module indirection exists so
// tests `vi.mock` it. Only the late-arrival tests drive it; everything else
// never calls fetch, so the default `vi.fn()` (returns undefined) is harmless.
vi.mock("../core/common/fetch/nativeFetch", () => ({nativeFetch: vi.fn()}));

const routes: RoutesMap = {home: {path: "/", handler: "H"}};

function req(controller?: AbortController, path = "/"): Request {
  return new Request(`http://localhost${path}`, controller ? {signal: controller.signal} : undefined);
}

/** A `definePage` whose directive is a plain 200 and whose elements are fixed. */
function okPage(elements: ReactElement[]) {
  return definePage(() => ({
    getRouteDirective: () => ({kind: "ok"}),
    getElements: () => elements,
  }));
}

/** A Root gated on a `when` promise, with a text marker for offset/content checks. */
function slowRoot(when: Promise<unknown>, marker: string): ReactElement {
  return <Root when={when}>{marker}</Root>;
}

/** A promise that never settles — keeps a Root PENDING across an abort. */
function neverResolves(): Promise<unknown> {
  return new Promise<unknown>(() => {});
}

/** Offset of the `fetchCache` data write — the true bootstrap (fold) landmark. */
function bootstrapOffset(html: string): number {
  const event = findPipeEvents(html).find((e) => e.kind === "data" && e.key === FETCH_CACHE_KEY);
  if (!event) throw new Error("no fetchCache bootstrap write found");
  return event.offset;
}

describe("handlePage rendering", () => {
  describe("Basic rendering", () => {
    test("one Root renders DOCTYPE, head, and a data-verso-root div with the content", async () => {
      const response = await run(req(), routes, okPage([<div>HELLO</div>]));
      const body = await responseBodyAsString(response);
      expect(body).toContain("<!DOCTYPE html>");
      const doc = parseHtml(body);
      expect(doc.querySelector("head")).not.toBeNull();
      const root = doc.querySelector("div[data-verso-root]");
      expect(root).not.toBeNull();
      expect(root?.textContent).toBe("HELLO");
    });

    test("body classes render as <body class=...>", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getElements: () => [<div>X</div>],
        getBodyClasses: () => ["alpha", "beta"],
      }));
      const body = await responseBodyAsString(await run(req(), routes, page));
      expect(parseHtml(body).body.className).toBe("alpha beta");
    });

    test("no body classes → <body> carries no class attribute", async () => {
      const body = await responseBodyAsString(await run(req(), routes, okPage([<div>X</div>])));
      expect(parseHtml(body).body.hasAttribute("class")).toBe(false);
    });
  });

  describe("Multi-root", () => {
    test("two roots render in document order", async () => {
      const body = await responseBodyAsString(
        await run(req(), routes, okPage([<div>FIRST</div>, <div>SECOND</div>])),
      );
      expect(body.indexOf("FIRST")).toBeLessThan(body.indexOf("SECOND"));
      expect(body.indexOf("FIRST")).toBeGreaterThanOrEqual(0);
    });

    test("a slow root does not block a fast root that precedes it", async () => {
      const dfd = Promise.withResolvers<void>();
      const response = await run(req(), routes, okPage([<div>FASTA</div>, slowRoot(dfd.promise, "SLOWB")]));
      const sr = streamReader(response);
      // FASTA flushes while the slow root is still pending (unresolved).
      await sr.readUntil((t) => t.includes("FASTA"));
      expect(sr.text()).not.toContain("SLOWB");
      dfd.resolve();
      await sr.readAll();
      expect(sr.text()).toContain("SLOWB");
    });

    test("a slow root blocks a fast root that follows it (ordering guarantee)", async () => {
      const dfd = Promise.withResolvers<void>();
      const response = await run(req(), routes, okPage([slowRoot(dfd.promise, "SLOWA"), <div>FASTB</div>]));
      const sr = streamReader(response);
      await sr.readUntil((t) => t.includes("</head>"));
      // FASTB is rendered but cannot flush ahead of the still-pending SLOWA.
      expect(await sr.raceOpen(50)).toBe("open");
      dfd.resolve();
      await sr.readAll();
      const body = sr.text();
      expect(body.indexOf("SLOWA")).toBeLessThan(body.indexOf("FASTB"));
    });

    test("makeRootComponent custom root renders correctly", async () => {
      const Custom = makeRootComponent<{label: string}>(
        ({label}) => <span>{label}</span>,
        () => ({id: "custom-root"}),
      );
      const body = await responseBodyAsString(
        await run(req(), routes, okPage([<Custom label="CUSTOMROOT" />])),
      );
      const doc = parseHtml(body);
      const root = doc.querySelector("div[data-verso-root]#custom-root");
      expect(root).not.toBeNull();
      expect(root?.querySelector("span")?.textContent).toBe("CUSTOMROOT");
    });

    test("RootContainer wraps its children in a <div> with the container's props", async () => {
      const page = okPage([
        <RootContainer id="my-container" className="wrap">
          <div>INNER</div>
        </RootContainer>,
      ]);
      const body = await responseBodyAsString(await run(req(), routes, page));
      const container = parseHtml(body).querySelector("div#my-container.wrap");
      expect(container).not.toBeNull();
      expect(container?.querySelector("div[data-verso-root]")?.textContent).toBe("INNER");
    });

    test("nested RootContainer elements produce nested wrapper divs", async () => {
      const page = okPage([
        <RootContainer id="outer">
          <RootContainer id="inner">
            <div>DEEP</div>
          </RootContainer>
        </RootContainer>,
      ]);
      const body = await responseBodyAsString(await run(req(), routes, page));
      const inner = parseHtml(body).querySelector("div#outer > div#inner");
      expect(inner).not.toBeNull();
      expect(inner?.querySelector("div[data-verso-root]")?.textContent).toBe("DEEP");
    });

    test("empty RootContainer renders an open+close div with no inner roots", async () => {
      const page = okPage([<RootContainer id="empty" />]);
      const body = await responseBodyAsString(await run(req(), routes, page));
      const container = parseHtml(body).querySelector("div#empty");
      expect(container).not.toBeNull();
      expect(container?.querySelector("div[data-verso-root]")).toBeNull();
    });
  });

  describe("Scripts", () => {
    test("external scripts render <script src> with async/defer", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getElements: () => [<div>X</div>],
        getScripts: () => [{src: "/app.js", async: true, defer: true}],
      }));
      const body = await responseBodyAsString(await run(req(), routes, page));
      const script = parseHtml(body).querySelector('script[src="/app.js"]');
      expect(script).not.toBeNull();
      expect(script?.hasAttribute("async")).toBe(true);
      expect(script?.hasAttribute("defer")).toBe(true);
    });

    test("inline scripts render <script> with the text field as content", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getElements: () => [<div>X</div>],
        getScripts: () => [{text: "console.log('inline-script-body')"}],
      }));
      const body = await responseBodyAsString(await run(req(), routes, page));
      // page scripts carry the data-verso-script-element sentinel, which
      // distinguishes them from the VersoPipe inline scripts.
      const script = parseHtml(body).querySelector("script[data-verso-script-element]");
      expect(script).not.toBeNull();
      expect(script?.textContent).toContain("console.log('inline-script-body')");
    });

    test("script type attribute is included when set", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getElements: () => [<div>X</div>],
        getScripts: () => [{src: "/mod.js", type: "module"}],
      }));
      const body = await responseBodyAsString(await run(req(), routes, page));
      expect(parseHtml(body).querySelector('script[src="/mod.js"]')?.getAttribute("type")).toBe("module");
    });
  });

  describe("Render errors", () => {
    test("a root that throws during renderToString renders an empty <div> fallback", async () => {
      const Boom: FC = () => {
        throw new Error("render boom");
      };
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const body = await responseBodyAsString(await run(req(), routes, okPage([<Boom />])));
      const root = parseHtml(body).querySelector("div[data-verso-root]");
      // the response did not crash: a (now empty) root div is still present so
      // the client has something to hydrate into.
      expect(root).not.toBeNull();
      expect(root?.textContent).toBe("");
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe("TheFold and bootstrap", () => {
    test("bootstrap lands precisely at the fold (preRoot < bootstrap < postRoot)", async () => {
      const page = okPage([<div>PREFOLD</div>, <TheFold />, <div>POSTFOLD</div>]);
      const body = await responseBodyAsString(await run(req(), routes, page));
      const boot = bootstrapOffset(body);
      expect(body.indexOf("PREFOLD")).toBeLessThan(boot);
      expect(boot).toBeLessThan(body.indexOf("POSTFOLD"));
    });

    test("each separately-arriving post-fold root emits its own hydrateRootsUpTo(N)", async () => {
      // tokens: 0=root, 1=fold, 2=root(POST1), 3=root(POST2, slow). Post-fold
      // roots that arrive in the same flush batch into a single cumulative
      // hydrateRootsUpTo(max) (the "up to N" semantics) — so to observe one call
      // per root they must flush separately, which a slow second root forces.
      const dfd = Promise.withResolvers<void>();
      const page = okPage([<div>PRE</div>, <TheFold />, <div>POST1</div>, slowRoot(dfd.promise, "POST2")]);
      const sr = streamReader(await run(req(), routes, page));
      await sr.readUntil((t) =>
        findPipeCalls(t).some((c) => c.fn === FN_HYDRATE_ROOTS_UP_TO && c.args[0] === 2),
      );
      dfd.resolve();
      await sr.readAll();
      const hydrateArgs = findPipeCalls(sr.text())
        .filter((c) => c.fn === FN_HYDRATE_ROOTS_UP_TO)
        .map((c) => c.args[0]);
      expect(hydrateArgs).toContain(2);
      expect(hydrateArgs).toContain(3);
    });

    test("no TheFold declared → synthetic bootstrap after the last root", async () => {
      const body = await responseBodyAsString(await run(req(), routes, okPage([<div>ONLYROOT</div>])));
      expect(body.indexOf("ONLYROOT")).toBeLessThan(bootstrapOffset(body));
    });

    test("a second TheFold logs a warning and is ignored (one bootstrap only)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const page = okPage([<div>A</div>, <TheFold />, <div>B</div>, <TheFold />]);
      const body = await responseBodyAsString(await run(req(), routes, page));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("additional TheFold"));
      // only one fetchCache write (one bootstrap)
      const fetchCacheWrites = findPipeEvents(body).filter(
        (e) => e.kind === "data" && e.key === FETCH_CACHE_KEY,
      );
      expect(fetchCacheWrites).toHaveLength(1);
      expect(body).toContain("A");
      expect(body).toContain("B");
      warnSpy.mockRestore();
    });

    test("client manifest is streamed through the pipe when present", async () => {
      const manifest: ClientManifest = {
        global: {scripts: ["/g.js"], stylesheets: ["/g.css"]},
        routes: {home: {scripts: ["/home.js"], stylesheets: []}},
      };
      const opts: RunRouteOpts = {manifest};
      const body = await responseBodyAsString(
        await run(req(), routes, okPage([<div>X</div>, <TheFold />]), opts),
      );
      expect(findPipeValue(body, CLIENT_MANIFEST_KEY)).toEqual(manifest);
    });

    test("no manifest (dev default) → no clientManifest data write", async () => {
      const body = await responseBodyAsString(
        await run(req(), routes, okPage([<div>X</div>, <TheFold />])),
      );
      expect(findPipeValue(body, CLIENT_MANIFEST_KEY)).toBeUndefined();
    });
  });

  describe("Streaming chunk ordering", () => {
    test("first chunk ends at </head>", async () => {
      const sr = streamReader(await run(req(), routes, okPage([<div>X</div>])));
      await sr.readOne();
      expect(sr.chunks[0]?.trimEnd().endsWith("</head>")).toBe(true);
    });

    test("a fast root flushes before a slow root resolves", async () => {
      const dfd = Promise.withResolvers<void>();
      const sr = streamReader(await run(req(), routes, okPage([<div>FASTA</div>, slowRoot(dfd.promise, "SLOWB")])));
      await sr.readUntil((t) => t.includes("FASTA"));
      // FASTA is on the wire in its own chunk while SLOWB is still pending.
      expect(sr.chunks.some((c) => c.includes("FASTA"))).toBe(true);
      expect(sr.text()).not.toContain("SLOWB");
      dfd.resolve();
      await sr.readAll();
    });

    test("a slow root blocks subsequent roots from flushing", async () => {
      const dfd = Promise.withResolvers<void>();
      const sr = streamReader(await run(req(), routes, okPage([slowRoot(dfd.promise, "SLOWA"), <div>FASTB</div>])));
      await sr.readUntil((t) => t.includes("</head>"));
      // nothing flushes past the head while index 0 is pending
      expect(await sr.raceOpen(50)).toBe("open");
      expect(sr.text()).not.toContain("FASTB");
      dfd.resolve();
      await sr.readAll();
    });

    test("stream remains open while a pending root exists", async () => {
      const dfd = Promise.withResolvers<void>();
      const sr = streamReader(await run(req(), routes, okPage([slowRoot(dfd.promise, "SLOW")])));
      await sr.readUntil((t) => t.includes("</head>"));
      expect(await sr.raceOpen(50)).toBe("open");
      expect(sr.isDone()).toBe(false);
      dfd.resolve();
      await sr.readAll();
      expect(sr.isDone()).toBe(true);
    });

    test("stream closes after all roots are written and bootstrap completes", async () => {
      const sr = streamReader(await run(req(), routes, okPage([<div>ROOTX</div>])));
      await sr.readAll();
      expect(sr.isDone()).toBe(true);
      const body = sr.text();
      expect(body).toContain("ROOTX");
      expect(findPipeValue(body, FETCH_CACHE_KEY)).not.toBeUndefined();
      expect(body.trimEnd().endsWith("</html>")).toBe(true);
    });

    test("the bootstrap chunk arrives after pre-fold and before post-fold chunks", async () => {
      const chunks = await collectChunks(
        await run(req(), routes, okPage([<div>PREFOLD</div>, <TheFold />, <div>POSTFOLD</div>])),
      );
      const preIdx = chunks.findIndex((c) => c.includes("PREFOLD"));
      const bootIdx = chunks.findIndex((c) => findPipeValue(c, FETCH_CACHE_KEY) !== undefined);
      const postIdx = chunks.findIndex((c) => c.includes("POSTFOLD"));
      expect(preIdx).toBeGreaterThanOrEqual(0);
      expect(preIdx).toBeLessThan(bootIdx);
      expect(bootIdx).toBeLessThan(postIdx);
    });

    test("hydrateRootsUpTo(N) appears in a chunk after root N's chunk", async () => {
      const chunks = await collectChunks(
        await run(req(), routes, okPage([<div>PRE</div>, <TheFold />, <div>POSTROOT</div>])),
      );
      const rootChunk = chunks.findIndex((c) => c.includes("POSTROOT"));
      const hydrateChunk = chunks.findIndex((c) =>
        findPipeCalls(c).some((p) => p.fn === FN_HYDRATE_ROOTS_UP_TO && p.args[0] === 2),
      );
      expect(rootChunk).toBeGreaterThanOrEqual(0);
      expect(hydrateChunk).toBeGreaterThan(rootChunk);
    });
  });

  describe("Render abort", () => {
    test("pending roots are marked ABORTED and skipped; the page still closes", async () => {
      const controller = new AbortController();
      const sr = streamReader(
        await run(req(controller), routes, okPage([<div>FASTA</div>, slowRoot(neverResolves(), "SLOWB")])),
      );
      await sr.readUntil((t) => t.includes("FASTA"));
      controller.abort();
      await sr.readAll();
      expect(sr.isDone()).toBe(true);
      const body = sr.text();
      expect(body).toContain("FASTA");
      expect(body).not.toContain("SLOWB");
    });

    test("abort after bootstrap emits an abortHydration() call", async () => {
      const controller = new AbortController();
      const sr = streamReader(
        await run(
          req(controller),
          routes,
          okPage([<div>PREFOLD</div>, <TheFold />, slowRoot(neverResolves(), "SLOW")]),
        ),
      );
      // wait until bootstrap has streamed (haveBootstrapped is true), then abort
      await sr.readUntil((t) => findPipeValue(t, FETCH_CACHE_KEY) !== undefined);
      controller.abort();
      await sr.readAll();
      expect(findPipeCalls(sr.text()).some((c) => c.fn === FN_ABORT_HYDRATION)).toBe(true);
    });

    test("abort before bootstrap emits no abortHydration() call", async () => {
      const controller = new AbortController();
      const sr = streamReader(
        await run(req(controller), routes, okPage([slowRoot(neverResolves(), "SLOW")])),
      );
      // only the head chunk has flushed; no fold has been reached
      await sr.readUntil((t) => t.includes("</head>"));
      controller.abort();
      await sr.readAll();
      expect(sr.isDone()).toBe(true);
      expect(findPipeCalls(sr.text()).some((c) => c.fn === FN_ABORT_HYDRATION)).toBe(false);
    });

    test("a never-aborted signal with all roots resolved finishes cleanly", async () => {
      const controller = new AbortController();
      const body = await responseBodyAsString(
        await run(req(controller), routes, okPage([<div>CLEAN</div>])),
      );
      expect(body).toContain("CLEAN");
      expect(findPipeCalls(body).some((c) => c.fn === FN_ABORT_HYDRATION)).toBe(false);
      expect(body.trimEnd().endsWith("</html>")).toBe(true);
    });
  });

  describe("Late arrivals", () => {
    beforeEach(() => {
      vi.mocked(nativeFetch).mockReset();
    });

    test("a fetch pending at the fold emits receiveLateDataArrival after the fold", async () => {
      const fetchDfd = Promise.withResolvers<Response>();
      vi.mocked(nativeFetch).mockReturnValueOnce(fetchDfd.promise);
      const page = definePage(() => ({
        getRouteDirective: () => {
          // fire-and-forget: registers as pending synchronously, stays pending
          // until we resolve the mocked native fetch below.
          void Fetch.fetch("/api/data");
          return {kind: "ok"};
        },
        getElements: () => [<div>ROOT</div>, <TheFold />],
      }));
      const response = await run(req(), routes, page);
      const bodyPromise = responseBodyAsString(response);
      // let writePage reach the fold and capture the pending fetch before we
      // resolve it (resolving earlier would settle it before the fold).
      await delay(20);
      fetchDfd.resolve(new Response("late data", {headers: {"content-type": "text/plain"}}));
      const body = await bodyPromise;
      expect(findPipeCalls(body).some((c) => c.fn === FN_RECEIVE_LATE_DATA_ARRIVAL)).toBe(true);
    });

    test("no pending fetches at the fold → no late-arrival calls", async () => {
      const body = await responseBodyAsString(
        await run(req(), routes, okPage([<div>ROOT</div>, <TheFold />])),
      );
      expect(findPipeCalls(body).some((c) => c.fn === FN_RECEIVE_LATE_DATA_ARRIVAL)).toBe(false);
    });

    test("abort while waiting for late arrivals → page finishes without them", async () => {
      const fetchDfd = Promise.withResolvers<Response>();
      vi.mocked(nativeFetch).mockReturnValueOnce(fetchDfd.promise);
      const controller = new AbortController();
      const page = definePage(() => ({
        getRouteDirective: () => {
          void Fetch.fetch("/api/data");
          return {kind: "ok"};
        },
        // a never-resolving post-fold root keeps the abort landing while the
        // late-arrival fetch is still pending, so didAbort() is true by the time
        // wrapUpLateArrivals() runs and short-circuits.
        getElements: () => [<TheFold />, slowRoot(neverResolves(), "SLOW")],
      }));
      const sr = streamReader(await run(req(controller), routes, page));
      await sr.readUntil((t) => findPipeValue(t, FETCH_CACHE_KEY) !== undefined);
      controller.abort();
      await sr.readAll();
      expect(sr.isDone()).toBe(true);
      // the still-pending fetch never produces a late-arrival call
      expect(findPipeCalls(sr.text()).some((c) => c.fn === FN_RECEIVE_LATE_DATA_ARRIVAL)).toBe(false);
      // resolving the fetch after the fact must not change the closed output
      fetchDfd.resolve(new Response("ignored"));
    });
  });

  describe("End-of-data signal", () => {
    // The client tears down the VersoPipe on FN_SIGNAL_END_OF_DATA. These tests
    // pin the server contract the client's late-arrival handling depends on:
    // end-of-data must be the *terminal* pipe call, emitted after roots-complete
    // and after every late arrival. If it ever moved ahead of a late arrival,
    // that arrival would land against an already-destroyed pipe on the client —
    // the exact race the end-of-data signal was introduced to close. See the
    // paired client-side assertions in clientHydration.client.test.ts.

    // pipe-call fns in document (= emission) order.
    const callFns = (html: string): string[] =>
      findPipeEvents(html).flatMap((e) => (e.kind === "call" ? [e.fn] : []));

    test("end-of-data is the terminal pipe call, after roots-complete and all late arrivals", async () => {
      const fetchDfd = Promise.withResolvers<Response>();
      vi.mocked(nativeFetch).mockReturnValueOnce(fetchDfd.promise);
      const page = definePage(() => ({
        getRouteDirective: () => {
          void Fetch.fetch("/api/data");
          return {kind: "ok"};
        },
        getElements: () => [<div>ROOT</div>, <TheFold />],
      }));
      const response = await run(req(), routes, page);
      const bodyPromise = responseBodyAsString(response);
      // let writePage reach the fold and capture the pending fetch before
      // resolving it, so it genuinely pipes as a late arrival.
      await delay(20);
      fetchDfd.resolve(new Response("late data", {headers: {"content-type": "text/plain"}}));
      const fns = callFns(await bodyPromise);

      const endIdx = fns.indexOf(FN_SIGNAL_END_OF_DATA);
      const rootsCompleteIdx = fns.indexOf(FN_SIGNAL_ROOTS_COMPLETE);
      const lastLateIdx = fns.lastIndexOf(FN_RECEIVE_LATE_DATA_ARRIVAL);

      // it's actually emitted, exactly once, and it's the very last call
      expect(fns.filter((f) => f === FN_SIGNAL_END_OF_DATA)).toHaveLength(1);
      expect(fns.at(-1)).toBe(FN_SIGNAL_END_OF_DATA);
      // sanity: this run really did produce both prerequisites
      expect(rootsCompleteIdx).toBeGreaterThanOrEqual(0);
      expect(lastLateIdx).toBeGreaterThanOrEqual(0);
      // the ordering the client relies on for teardown
      expect(endIdx).toBeGreaterThan(rootsCompleteIdx);
      expect(endIdx).toBeGreaterThan(lastLateIdx);
    });

    test("end-of-data is still emitted once as the terminal call with no late arrivals", async () => {
      const fns = callFns(
        await responseBodyAsString(await run(req(), routes, okPage([<div>ROOT</div>, <TheFold />]))),
      );
      expect(fns.filter((f) => f === FN_SIGNAL_END_OF_DATA)).toHaveLength(1);
      expect(fns.at(-1)).toBe(FN_SIGNAL_END_OF_DATA);
    });
  });
});
