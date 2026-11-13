import {describe, test, expect} from "vitest";
import {defineEndpoint} from "../core/common/handler/Endpoint";
import type {RoutesMap} from "../build/config";
import {responseBodyAsString, run, streamReader} from "./helpers/serveResponseHarness";

const routes: RoutesMap = {home: {path: "/", handler: "H"}};

function req(path = "/"): Request {
  return new Request(`http://localhost${path}`);
}

describe("handleEndpoint responses", () => {
  test("string body is returned verbatim", async () => {
    const endpoint = defineEndpoint(() => ({
      getRouteDirective: () => ({kind: "ok"}),
      getContentType: () => "text/plain",
      getResponseData: () => "hello, endpoint",
    }));
    const response = await run(req(), routes, endpoint);
    expect(await responseBodyAsString(response)).toBe("hello, endpoint");
  });

  test("ArrayBuffer body passes its bytes through", async () => {
    const source = "buffer-payload";
    const buffer = new TextEncoder().encode(source).buffer;
    const endpoint = defineEndpoint(() => ({
      getRouteDirective: () => ({kind: "ok"}),
      getContentType: () => "application/octet-stream",
      getResponseData: () => buffer,
    }));
    const response = await run(req(), routes, endpoint);
    expect(await responseBodyAsString(response)).toBe(source);
  });

  test("ReadableStream body passes through incrementally (not buffered)", async () => {
    const encoder = new TextEncoder();
    const transform = new TransformStream<Uint8Array, Uint8Array>();
    const writer = transform.writable.getWriter();
    const endpoint = defineEndpoint(() => ({
      getRouteDirective: () => ({kind: "ok"}),
      getContentType: () => "text/plain",
      getResponseData: () => transform.readable,
    }));
    const response = await run(req(), routes, endpoint);
    const sr = streamReader(response);

    await writer.write(encoder.encode("CHUNK1"));
    await sr.readUntil((t) => t.includes("CHUNK1"));
    expect(sr.text()).toContain("CHUNK1");
    expect(sr.text()).not.toContain("CHUNK2");
    expect(sr.isDone()).toBe(false);

    await writer.write(encoder.encode("CHUNK2"));
    await sr.readUntil((t) => t.includes("CHUNK2"));
    expect(sr.text()).toBe("CHUNK1CHUNK2");

    await writer.close();
    await sr.readAll();
    expect(sr.isDone()).toBe(true);
    expect(sr.text()).toBe("CHUNK1CHUNK2");
  });
});
