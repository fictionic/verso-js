import {describe, test, expect, vi} from "vitest";
import {definePage} from "../core/common/handler/Page";
import {defineEndpoint} from "../core/common/handler/Endpoint";
import {defineMiddleware} from "../core/common/handler/Middleware";
import {setCookie} from "../core/common/cookies";
import type {RoutesMap} from "../core/config";
import {parseHtml, responseBodyAsString, run} from "./helpers/serveResponseHarness";

const routes: RoutesMap = {home: {path: "/", handler: "H"}};

function req(path = "/"): Request {
  return new Request(`http://localhost${path}`);
}

describe("serveResponse envelope", () => {
  describe("Dispatch passthrough", () => {
    test("URL matching no route -> hattip 404 fallback (body 'Not found')", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getElements: () => [],
      }));
      const response = await run(req("/missing"), routes, page);
      expect(response.status).toBe(404);
      expect(await responseBodyAsString(response)).toBe("Not found");
    });
  });

  describe("Status & redirect headers", () => {
    test("200 directive -> status 200", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.status).toBe(200);
    });

    test("redirect directive -> status matches and Location carries the directive's location", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "redirect", code: 302, location: "/elsewhere"}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/elsewhere");
    });

    test("a handler's getHeaders does NOT ride a redirect", async () => {
      // page headers are for the rendered body. For example, a cacheable
      // Cache-Control on a 302 would poison the redirect in caches.
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
    test("page handler -> Content-Type is text/html; charset=utf-8", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "ok"}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    });

    test("endpoint with getContentType -> that Content-Type", async () => {
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
    test("kind 'error' resolution -> handleError returns 500 'Internal Server Error'", async () => {
      const page = definePage(() => ({
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
    test("404 page resolved without a handler (hasBody false) -> bare response, null body", async () => {
      const page = definePage(() => ({
        getRouteDirective: () => ({kind: "status", code: 404, hasBody: false}),
        getElements: () => [],
      }));
      const response = await run(req(), routes, page);
      expect(response.status).toBe(404);
      expect(response.body).toBeNull();
    });

    test("404 page resolved with hasBody: true -> handler attached, full page streams", async () => {
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

    test("500 page resolved without a handler -> bare response, null body", async () => {
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
