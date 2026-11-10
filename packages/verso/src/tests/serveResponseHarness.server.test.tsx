import {describe, test, expect} from "vitest";
import {definePage} from "../core/common/handler/Page";
import type {RoutesMap} from "../build/config";
import {parseHtml, responseBodyAsString, run} from "./helpers/serveResponseHarness";

// just a smoke test for the harness
describe("serveResponse harness smoke test", () => {
  test("a single-root page renders a full HTML document", async () => {
    const routes: RoutesMap = {
      home: {path: "/", handler: "HomeHandler"},
    };
    const page = definePage(() => ({
      getRouteDirective: () => ({kind: "ok"}),
      getElements: () => [<div>Hello</div>],
    }));

    const response = await run(
      new Request("http://localhost/"),
      routes,
      page,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");

    const body = await responseBodyAsString(response);
    expect(body).toContain("<!DOCTYPE html>");

    const doc = parseHtml(body);
    expect(doc.querySelector("div[data-verso-root]")?.textContent).toBe("Hello");
  });
});
