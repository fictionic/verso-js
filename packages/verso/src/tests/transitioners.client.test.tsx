import type {ClientManifest} from "@verso-js/contract";
import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import {ScriptTransitioner} from "../core/client/transitioners/scripts";
import {StyleTransitioner} from "../core/client/transitioners/styles";
import {
  DEV_ROUTE_CSS_PATH,
  DEV_VITE_STYLE_ID_ATTR,
  PAGE_HEADER_SCRIPT_ELEMENT_ATTR,
  PAGE_HEADER_STYLE_ELEMENT_ATTR,
} from "../core/common/constants";
import type {Stylesheet} from "../core/common/handler/Page";
import {devOnly} from "../userland/testing/dev";

// Suite 20: structural lifecycle of the client style/script transitioners, in
// jsdom. Production mode only — setup.ts sets globalThis.IS_DEV = false, and the
// spec's assertions (<link rel="stylesheet"> by href, shared-node persistence)
// map to the production path. Real-paint FOUC / deferred-teardown timing is
// browser-only and verified manually (see the spec's status note).

// A manifest with a global shared stylesheet and a page-specific stylesheet on
// route "b". Every route we transition to must have an entry or the prod path
// throws `no bundles for route <name>`.
const manifest: ClientManifest = {
  global: {scripts: [], stylesheets: ["/shared.css"]},
  routes: {
    a: {scripts: [], stylesheets: []},
    b: {scripts: [], stylesheets: ["/page-b.css"]},
  },
};

afterEach(() => {
  document.head.innerHTML = "";
});

// transitionStyles appends each new <link> and awaits its `onload`, which jsdom
// never fires for <link>. Drive the promise by firing `load` on the pending
// links after they've been appended (one macrotask covers the single
// getRouteStylesheets microtask that precedes the appends).
async function settleStyles(promise: Promise<() => void>): Promise<() => void> {
  await new Promise((r) => setTimeout(r, 0));
  document.head
    .querySelectorAll("link")
    .forEach((link) => link.dispatchEvent(new Event("load")));
  return promise;
}

function styleLinks(): HTMLLinkElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  );
}

function hasStyleHref(href: string): boolean {
  return styleLinks().some((n) => n.getAttribute("href") === href);
}

// Plant a server-rendered stylesheet <link> carrying the marker attr, mirroring
// what the server writes into <head> for the starting route.
function seedServerStyle(href: string): HTMLLinkElement {
  const link = document.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", href);
  link.setAttribute(PAGE_HEADER_STYLE_ELEMENT_ATTR, "");
  document.head.appendChild(link);
  return link;
}

describe("StyleTransitioner", () => {
  test("page-specific stylesheet is added on transition to a route that needs it, and removed on transition away", async () => {
    const t = new StyleTransitioner(manifest);

    // transition to route "b", which needs /page-b.css
    await settleStyles(t.transitionStyles("b", []));
    expect(hasStyleHref("/page-b.css")).toBe(true);

    // transition away to route "a", which does not need it. The cleanup closure
    // (run by the real caller after the body swap) removes now-unneeded styles.
    const cleanup = await settleStyles(t.transitionStyles("a", []));
    expect(hasStyleHref("/page-b.css")).toBe(true); // still present until cleanup
    cleanup();
    expect(hasStyleHref("/page-b.css")).toBe(false);
  });

  test("a stylesheet shared by both routes persists across the transition (same node stays in the DOM)", async () => {
    // Seed the starting route ("a")'s server-rendered assets: the shared global
    // stylesheet is already in <head>. readServerStyles populates `loaded` so
    // the transitioner treats it as already present.
    const sharedNode = seedServerStyle("/shared.css");
    const t = new StyleTransitioner(manifest);
    t.readServerStyles();

    // transition to "b": /shared.css is in the global set (already loaded), so
    // it's re-appended (moved for specificity), not recreated.
    const cleanup = await settleStyles(t.transitionStyles("b", []));
    cleanup();

    const sharedAfter = styleLinks().filter(
      (n) => n.getAttribute("href") === "/shared.css",
    );
    expect(sharedAfter).toHaveLength(1);
    expect(sharedAfter[0]).toBe(sharedNode); // node identity preserved
    expect(document.head.contains(sharedNode)).toBe(true);
  });
});

describe("ScriptTransitioner", () => {
  test("a script needed by both routes is not re-added on a there-and-back transition", () => {
    const t = new ScriptTransitioner();
    const appScript = [{src: "/app.js"}];

    // A -> B -> A, each route needing /app.js
    t.transitionScripts(appScript); // A: adds
    t.transitionScripts(appScript); // B: already loaded, skip
    t.transitionScripts(appScript); // A again: still skip

    const appScripts = document.head.querySelectorAll<HTMLScriptElement>(
      'script[src="/app.js"]',
    );
    expect(appScripts).toHaveLength(1);
  });

  test("readServerScripts seeds server-rendered scripts so they are not re-added", () => {
    // Plant a server-rendered <script> for the starting route.
    const seeded = document.createElement("script");
    seeded.setAttribute("src", "/app.js");
    seeded.setAttribute(PAGE_HEADER_SCRIPT_ELEMENT_ATTR, "");
    document.head.appendChild(seeded);

    const t = new ScriptTransitioner();
    t.readServerScripts();

    // transitioning to a route that needs the same script does not duplicate it
    t.transitionScripts([{src: "/app.js"}]);

    const appScripts = document.head.querySelectorAll<HTMLScriptElement>(
      'script[src="/app.js"]',
    );
    expect(appScripts).toHaveLength(1);
    expect(appScripts[0]).toBe(seeded);
  });
});

// The dev path of StyleTransitioner is a completely different mechanism from
// prod: instead of creating <link href> nodes from the manifest, it reuses the
// inline <style> tags Vite injects (keyed by data-vite-dev-id), fetches
// per-route CSS over the dev endpoint, and on teardown *disables* nodes rather
// than removing them (so they stay in Vite's sheetsMap for hot reload).
// (scripts.ts has no dev branch, so no dev script tests.) The genuinely
// browser-only parts — whether Vite recognizes the reused node, whether
// toggling `disabled` repaints, hot reload — stay manually verified; the
// control flow around them is what these tests pin.
//
// devOnly() flips globalThis.IS_DEV for this block. Every dev transition fetches
// route CSS, so fetch is stubbed to an empty route CSS set; stylesheets are then
// driven purely through the pageStylesheets argument.
devOnly(() => {
  const VITE_A = "/abs/a.css";

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      statusText: "OK",
      json: async () => ({stylesheets: [] as Stylesheet[]}),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // A page stylesheet tagged with a Vite dev id — this is how dev-mode
  // stylesheets are keyed (by the id, not the href).
  function viteStylesheet(viteId: string, href = "/ignored.css"): Stylesheet {
    return {href, dataAttr: {name: DEV_VITE_STYLE_ID_ATTR, value: viteId}};
  }

  // Simulate Vite injecting an inline <style> for a module, tagged with its dev id.
  function plantViteStyle(viteId: string): HTMLStyleElement {
    const style = document.createElement("style");
    style.setAttribute(DEV_VITE_STYLE_ID_ATTR, viteId);
    style.innerHTML = ".x{}";
    document.head.appendChild(style);
    return style;
  }

  test("adopts Vite's injected <style> instead of creating a <link>", async () => {
    const planted = plantViteStyle(VITE_A);
    const t = new StyleTransitioner(manifest);

    await t.transitionStyles("a", [viteStylesheet(VITE_A)]);

    // no <link> was created — the existing Vite <style> was adopted
    expect(document.head.querySelectorAll("link").length).toBe(0);
    const styles = document.head.querySelectorAll(
      `style[${DEV_VITE_STYLE_ID_ATTR}="${VITE_A}"]`,
    );
    expect(styles).toHaveLength(1);
    expect(styles[0]).toBe(planted);
  });

  test("missing Vite style is logged and skipped (rejected, not added)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = new StyleTransitioner(manifest);

    // no plantViteStyle — the id has no matching injected <style>
    const cleanup = await t.transitionStyles("a", [viteStylesheet(VITE_A)]);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`could not find vite style ${VITE_A}`),
    );
    expect(document.head.querySelectorAll("link, style").length).toBe(0);
    expect(typeof cleanup).toBe("function"); // Promise.allSettled swallowed the rejection
  });

  test("keys by Vite dev id, not href — a seeded node persists across differing hrefs", async () => {
    // Seed a server-rendered Vite <style> and register it via readServerStyles.
    const planted = plantViteStyle(VITE_A);
    planted.setAttribute(PAGE_HEADER_STYLE_ELEMENT_ATTR, "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = new StyleTransitioner(manifest);
    t.readServerStyles();

    // Transition with the *same* vite id but a *different* href. It must dedup by
    // the id to the already-loaded node, not create a new one.
    await t.transitionStyles("a", [viteStylesheet(VITE_A, "/completely-different.css")]);

    const styles = document.head.querySelectorAll(
      `style[${DEV_VITE_STYLE_ID_ATTR}="${VITE_A}"]`,
    );
    expect(styles).toHaveLength(1);
    expect(styles[0]).toBe(planted);
    expect(document.head.querySelectorAll("link").length).toBe(0);
    // If it had keyed by href instead of the id, the node would not have been
    // found in `loaded`, triggering a failed findViteStyle lookup + error log.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("teardown disables the node and keeps it in the DOM (does not remove it)", async () => {
    const planted = plantViteStyle(VITE_A);
    const t = new StyleTransitioner(manifest);

    // adopt A
    await t.transitionStyles("a", [viteStylesheet(VITE_A)]);
    expect(planted.disabled).toBe(false);

    // transition to a route that no longer needs A, then run the cleanup closure
    const cleanup = await t.transitionStyles("b", []);
    cleanup();

    // dev keeps the node in the DOM for Vite's sheetsMap, only disabling it
    expect(document.head.contains(planted)).toBe(true);
    expect(planted.disabled).toBe(true);
  });

  test("re-enables a previously-disabled node on transition back", async () => {
    const planted = plantViteStyle(VITE_A);
    const t = new StyleTransitioner(manifest);

    await t.transitionStyles("a", [viteStylesheet(VITE_A)]);
    const cleanup = await t.transitionStyles("b", []);
    cleanup();
    expect(planted.disabled).toBe(true);

    // back to a route that needs A: the same node is re-enabled, not recreated
    await t.transitionStyles("a", [viteStylesheet(VITE_A)]);
    expect(planted.disabled).toBe(false);
    expect(
      document.head.querySelectorAll(`style[${DEV_VITE_STYLE_ID_ATTR}="${VITE_A}"]`),
    ).toHaveLength(1);
  });

  test("skips global manifest stylesheets in dev (Vite owns global styles)", async () => {
    // manifest.global.stylesheets = ['/shared.css']; in dev that set is ignored.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = new StyleTransitioner(manifest);

    await t.transitionStyles("a", []);

    expect(document.head.querySelector('link[href="/shared.css"]')).toBeNull();
    expect(document.head.querySelectorAll("link").length).toBe(0);
    // If global stylesheets weren't skipped, /shared.css (no vite id) would be
    // routed through findViteStyle, miss, and log — so no-error proves it was
    // never even considered, not merely that the lookup failed.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("fetches per-route CSS from the dev endpoint with the route name encoded", async () => {
    const t = new StyleTransitioner(manifest);

    await t.transitionStyles("blog/post", []);

    expect(fetchMock).toHaveBeenCalledWith(
      `${DEV_ROUTE_CSS_PATH}?route=${encodeURIComponent("blog/post")}`,
    );
  });

  test("a failed route-CSS fetch is logged and yields no stylesheets (no throw)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const t = new StyleTransitioner(manifest);

    const cleanup = await t.transitionStyles("a", []);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to fetch dev route stylesheets"),
      expect.anything(),
    );
    expect(typeof cleanup).toBe("function");
    expect(document.head.querySelectorAll("link, style").length).toBe(0);
  });
});
