// Suite 1, Section 1 — Envelope (type-agnostic).
//
// Asserts on what `serveResponse` puts on the `Response`: status, headers,
// cookies, Content-Type, and the passthrough / bare-response / error paths.
// These tests do NOT inspect rendered HTML — that's Sections 2 (page) and 3
// (endpoint). The routing/directive *decision* matrix (which route matches,
// method mismatch, redirect detection, hasBody logic, getRouteDirective
// throwing) belongs to Suite 21 (resolver); here we only assert that
// `serveResponse` faithfully renders a `RouteResolution` onto a `Response`.
//
// Server pass only (the harness runs server-path code: `runWithServerRLS`,
// `renderToString`), hence the `.server.test.tsx` suffix.

import {describe, test, expect, vi} from "vitest";
import {definePage} from "../core/common/handler/Page";
import {defineEndpoint} from "../core/common/handler/Endpoint";
import {defineMiddleware} from "../core/common/handler/Middleware";
import {setCookie} from "../core/common/cookies";
import type {RoutesMap} from "../build/config";
import {parseHtml, responseBodyAsString, run} from "./helpers/serveResponseHarness";

// The single route every test resolves against (the handler is supplied per
// test via `run`'s single-definition convenience form).
const routes: RoutesMap = {home: {path: "/", handler: "H"}};

function req(path = "/"): Request {
  return new Request(`http://localhost${path}`);
}

describe("serveResponse envelope", () => {
  describe("Dispatch passthrough", () => {
    test("URL matching no route → hattip 404 fallback (body 'Not found')", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getElements: () => [],
      }));
      // `/missing` matches no route → `not-found` resolution → serveResponse
      // returns nothing → hattip's `finalHandler` yields the 404.
      const response = await run(req("/missing"), routes, page);
      expect(response.status).toBe(404);
      expect(await responseBodyAsString(response)).toBe("Not found");
    });
  });

  describe("Status & redirect headers", () => {
    test("200 directive → status 200", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.status).toBe(200);
    });

    test("redirect directive → status matches and Location carries the directive's location", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "redirect", code: 302, location: "/elsewhere"}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/elsewhere");
    });

    test("a handler's getHeaders does NOT ride a redirect", async () => {
      // A redirect resolution carries no handler, so the handler's getHeaders
      // never runs. This is deliberate: page getHeaders are representation
      // headers authored for the rendered body (Cache-Control, Link preload,
      // etc.). Leaking them onto a conditional redirect is actively wrong — a
      // cacheable Cache-Control on a 302 poisons the redirect in CDNs/browsers.
      // Cross-cutting headers that DO want to apply to redirects belong in
      // middleware / cookies, not the body handler.
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "redirect", code: 302, location: "/login"}),
        getHeaders: () => new Headers({"Cache-Control": "public, max-age=300"}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login");
      expect(response.headers.get("Cache-Control")).toBeNull();
    });
  });

  describe("Header accumulation", () => {
    test("handler getHeaders values appear in the response headers", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getHeaders: () => new Headers({"X-Handler": "handler-value"}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.headers.get("X-Handler")).toBe("handler-value");
    });

    test("middleware getHeaders accumulate WITH the handler's headers (both present)", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getHeaders: () => new Headers({"X-Handler": "handler-value"}),
        getElements: () => [],
      }));
      const mw = defineMiddleware("all", () => ({
        getHeaders: (next) => {
          const headers = next();
          headers.append("X-Middleware", "mw-value");
          return headers;
        },
      }));
      const response = await run(req(), routes, page, {globalMiddleware: [mw]});
      expect(response.headers.get("X-Handler")).toBe("handler-value");
      expect(response.headers.get("X-Middleware")).toBe("mw-value");
    });

    test("Set-Cookie and Location coexist on a redirect (no clobbering)", async () => {
      // A redirect resolution carries no handler, so the only header sources
      // are the cookie path (cookies set during getRouteDirective) and the
      // directive's Location. serveResponse appends both onto one Headers;
      // assert neither clobbers the other.
      const page = definePage(() => ({
        getRouteDirective: () => {
          setCookie("sid", "abc");
          return {kind: "redirect", code: 302, location: "/login"};
        },
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login");
      expect(response.headers.get("Set-Cookie")).toContain("sid=abc");
    });
  });

  describe("Cookies", () => {
    // The `set after consumeHeaders` / headers-locked invariant is owned by
    // Suite 11 (ServerCookies). Here we test only the wiring: a cookie set
    // during getRouteDirective reaches the response.
    test("a cookie set during getRouteDirective appears as a Set-Cookie header", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => {
          setCookie("session", "xyz");
          return {kind: "ok"};
        },
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.headers.get("Set-Cookie")).toContain("session=xyz");
    });

    test("multiple cookies produce multiple Set-Cookie headers", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => {
          setCookie("a", "1");
          setCookie("b", "2");
          return {kind: "ok"};
        },
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      const setCookies = response.headers.getSetCookie();
      expect(setCookies).toHaveLength(2);
      expect(setCookies.some((c) => c.startsWith("a=1"))).toBe(true);
      expect(setCookies.some((c) => c.startsWith("b=2"))).toBe(true);
    });
  });

  describe("Content-Type (cross-handler symmetry)", () => {
    // serveResponse reads Content-Type uniformly from the dispatched handler's
    // response; it does not branch on handler type.
    test("page handler → Content-Type is text/html; charset=utf-8", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    });

    test("endpoint with getContentType → that Content-Type", async () => {
      const endpoint = defineEndpoint(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getContentType: () => "application/json",
        getResponseData: () => "",
      }));
      const response = await run(req(), routes, endpoint);
      expect(response.headers.get("Content-Type")).toBe("application/json");
    });
  });

  describe("Errors", () => {
    test("kind 'error' resolution → handleError returns 500 'Internal Server Error'", async () => {
      const page = definePage(() => ({
        // throwing in getRouteDirective makes the resolver return kind: 'error';
        // serveResponse then throws, and compose's default handleError yields 500.
        getRouteDirective: () => {
          throw new Error("directive boom");
        },
        getElements: () => [],
      }));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await run(req(), routes, page);
      expect(response.status).toBe(500);
      expect(await responseBodyAsString(response)).toBe("Internal Server Error");
      errorSpy.mockRestore();
    });
  });

  describe("Non-2XX bodies", () => {
    test("404 page resolved without a handler (hasBody false) → bare response, null body", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "status", code: 404, hasBody: false}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.status).toBe(404);
      expect(response.body).toBeNull();
    });

    test("404 page resolved with hasBody: true → handler attached, full page streams", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "status", code: 404, hasBody: true}),
        getElements: () => [<div>not found</div>],
      }));
      const response = await run(req(), routes, page);
      expect(response.status).toBe(404);
      expect(response.body).not.toBeNull();
      const body = await responseBodyAsString(response);
      expect(body).toContain("<!DOCTYPE html>");
      expect(parseHtml(body).querySelector("div[data-verso-root]")?.textContent).toBe("not found");
    });

    test("500 page resolved without a handler → bare response, null body", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "status", code: 500, hasBody: false}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.status).toBe(500);
      expect(response.body).toBeNull();
    });
  });
});
