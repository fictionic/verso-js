// Suite 1, Section 3 — Endpoint responses.
//
// Endpoints-only wire-protocol assertions on the body shape `handleEndpoint`
// produces from `getResponseData()`. Content-Type wiring is covered by Section 1
// (cross-handler symmetry) and is not duplicated here. `handleEndpoint` pipes
// `getResponseData()`'s output through a `TransformStream` (via
// `new Response(data).body`), so a string/ArrayBuffer body round-trips its bytes
// and a `ReadableStream` body stays streaming rather than being buffered.
//
// Server pass only (the harness runs server-path code: `runWithServerRLS`,
// `serveResponse`), hence the `.server.test.ts` suffix — see the 2b/2c entries
// in _progress.md for the same rename rationale.

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
    // The bytes round-trip unchanged through the TransformStream.
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

    // First chunk: written, must become readable before the stream is closed —
    // if the body were buffered into a string before the Response was built,
    // nothing would arrive until close().
    await writer.write(encoder.encode("CHUNK1"));
    await sr.readUntil((t) => t.includes("CHUNK1"));
    expect(sr.text()).toContain("CHUNK1");
    expect(sr.text()).not.toContain("CHUNK2");
    expect(sr.isDone()).toBe(false);

    // Second chunk arrives only after it is written — proves the stream stays
    // open between writes and chunks flow in the order written.
    await writer.write(encoder.encode("CHUNK2"));
    await sr.readUntil((t) => t.includes("CHUNK2"));
    expect(sr.text()).toBe("CHUNK1CHUNK2");

    await writer.close();
    await sr.readAll();
    expect(sr.isDone()).toBe(true);
    expect(sr.text()).toBe("CHUNK1CHUNK2");
  });
});
