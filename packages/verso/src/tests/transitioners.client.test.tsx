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
import {tick} from "./util/promise";

// in prod, a transition to a route that is not in the manifest throws
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

// jsdom never fires `load` for <link>, so fire it by hand after the appends
async function settleStyles(promise: Promise<() => void>): Promise<() => void> {
  await tick();
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

    await settleStyles(t.transitionStyles("b", []));
    expect(hasStyleHref("/page-b.css")).toBe(true);

    const cleanup = await settleStyles(t.transitionStyles("a", []));
    expect(hasStyleHref("/page-b.css")).toBe(true);
    cleanup();
    expect(hasStyleHref("/page-b.css")).toBe(false);
  });

  test("a stylesheet shared by both routes persists across the transition (same node stays in the DOM)", async () => {
    const sharedNode = seedServerStyle("/shared.css");
    const t = new StyleTransitioner(manifest);
    t.readServerStyles();

    const cleanup = await settleStyles(t.transitionStyles("b", []));
    cleanup();

    const sharedAfter = styleLinks().filter(
      (n) => n.getAttribute("href") === "/shared.css",
    );
    expect(sharedAfter).toHaveLength(1);
    expect(sharedAfter[0]).toBe(sharedNode);
    expect(document.head.contains(sharedNode)).toBe(true);
  });
});

describe("ScriptTransitioner", () => {
  test("a script needed by both routes is not re-added on a there-and-back transition", () => {
    const t = new ScriptTransitioner();
    const appScript = [{src: "/app.js"}];

    t.transitionScripts(appScript);
    t.transitionScripts(appScript);
    t.transitionScripts(appScript);

    const appScripts = document.head.querySelectorAll<HTMLScriptElement>(
      'script[src="/app.js"]',
    );
    expect(appScripts).toHaveLength(1);
  });

  test("readServerScripts seeds server-rendered scripts so they are not re-added", () => {
    const seeded = document.createElement("script");
    seeded.setAttribute("src", "/app.js");
    seeded.setAttribute(PAGE_HEADER_SCRIPT_ELEMENT_ATTR, "");
    document.head.appendChild(seeded);

    const t = new ScriptTransitioner();
    t.readServerScripts();

    t.transitionScripts([{src: "/app.js"}]);

    const appScripts = document.head.querySelectorAll<HTMLScriptElement>(
      'script[src="/app.js"]',
    );
    expect(appScripts).toHaveLength(1);
    expect(appScripts[0]).toBe(seeded);
  });
});

// every dev transition fetches route CSS, so fetch is stubbed to return none
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

  function viteStylesheet(viteId: string, href = "/ignored.css"): Stylesheet {
    return {href, dataAttr: {name: DEV_VITE_STYLE_ID_ATTR, value: viteId}};
  }

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

    const cleanup = await t.transitionStyles("a", [viteStylesheet(VITE_A)]);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`could not find vite style ${VITE_A}`),
    );
    expect(document.head.querySelectorAll("link, style").length).toBe(0);
    expect(typeof cleanup).toBe("function");
  });

  test("keys by Vite dev id, not href: a seeded node persists across differing hrefs", async () => {
    const planted = plantViteStyle(VITE_A);
    planted.setAttribute(PAGE_HEADER_STYLE_ELEMENT_ATTR, "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = new StyleTransitioner(manifest);
    t.readServerStyles();

    await t.transitionStyles("a", [viteStylesheet(VITE_A, "/completely-different.css")]);

    const styles = document.head.querySelectorAll(
      `style[${DEV_VITE_STYLE_ID_ATTR}="${VITE_A}"]`,
    );
    expect(styles).toHaveLength(1);
    expect(styles[0]).toBe(planted);
    expect(document.head.querySelectorAll("link").length).toBe(0);
    // keying by href would cause a failed lookup, which logs an error
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("teardown disables the node and keeps it in the DOM (does not remove it)", async () => {
    const planted = plantViteStyle(VITE_A);
    const t = new StyleTransitioner(manifest);

    await t.transitionStyles("a", [viteStylesheet(VITE_A)]);
    expect(planted.disabled).toBe(false);

    const cleanup = await t.transitionStyles("b", []);
    cleanup();

    // Vite keeps the node in its sheetsMap for hot reload
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

    await t.transitionStyles("a", [viteStylesheet(VITE_A)]);
    expect(planted.disabled).toBe(false);
    expect(
      document.head.querySelectorAll(`style[${DEV_VITE_STYLE_ID_ATTR}="${VITE_A}"]`),
    ).toHaveLength(1);
  });

  test("skips global manifest stylesheets in dev (Vite owns global styles)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = new StyleTransitioner(manifest);

    await t.transitionStyles("a", []);

    expect(document.head.querySelector('link[href="/shared.css"]')).toBeNull();
    expect(document.head.querySelectorAll("link").length).toBe(0);
    // /shared.css has no vite id, so a lookup for it would fail and log an error
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
