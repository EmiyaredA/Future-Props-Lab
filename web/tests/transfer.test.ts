import { afterEach, expect, test, vi } from "vitest";
import {
  createUploadTransfer,
  measureResponse,
  uploadRequest,
  type TransferProgress,
} from "@platform/api/transfer";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("streams response bytes without buffering a second copy and handles unknown/compressed lengths", async () => {
  const cases: Record<string, string>[] = [
    { "Content-Length": "6" },
    {},
    { "Content-Length": "2", "Content-Encoding": "gzip" },
  ];
  for (const headers of cases) {
    const progress: TransferProgress[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    const result = measureResponse(new Response(body, { headers }), (p) =>
      progress.push(p),
    );
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6]),
    );
    expect(progress.at(-1)).toMatchObject({
      loaded: 6,
      phase: "completed",
      direction: "download",
    });
    expect(progress.at(-1)?.total).toBe(
      "Content-Length" in headers && !("Content-Encoding" in headers)
        ? 6
        : undefined,
    );
  }
});

test("does not intercept SSE or turn an HTTP failure into a successful transfer", () => {
  const progress = vi.fn();
  const sse = new Response("data: event\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });
  const failure = new Response("error", { status: 403 });
  expect(measureResponse(sse, progress)).toBe(sse);
  expect(measureResponse(failure, progress)).toBe(failure);
  expect(progress).not.toHaveBeenCalled();
});

test("propagates stream cancellation to its source", async () => {
  const cancel = vi.fn();
  const result = measureResponse(
    new Response(new ReadableStream({ cancel })),
    vi.fn(),
  );
  await result.body!.cancel();
  expect(cancel).toHaveBeenCalledOnce();
});

test("XHR preserves session/CSRF, measures upload, waits for the server, and supports cancellation", async () => {
  const instances: FakeXhr[] = [];
  class FakeXhr {
    upload: { onprogress?: (event: object) => void; onload?: () => void } = {};
    headers: Record<string, string> = {};
    withCredentials = false;
    response = new Blob(['{"ok":true}']);
    status = 200;
    statusText = "OK";
    onload?: () => void;
    onabort?: () => void;
    constructor() {
      instances.push(this);
    }
    open() {}
    setRequestHeader(key: string, value: string) {
      this.headers[key] = value;
    }
    getAllResponseHeaders() {
      return "Content-Type: application/json\r\n";
    }
    send() {}
    abort() {
      this.onabort?.();
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  const progress: TransferProgress[] = [];
  const body = new FormData();
  body.set("file", new Blob(["asset"]), "asset.txt");
  const request = new Request("http://localhost/v1/files", {
    method: "POST",
    credentials: "include",
    body,
    headers: { "X-CSRF-Token": "csrf" },
  });
  const capture = createUploadTransfer((p) => progress.push(p));
  expect(capture.capture(body)).toBe(body);
  const promise = capture.fetch(request);
  const xhr = instances[0]!;
  expect(xhr!.withCredentials).toBe(true);
  expect(xhr!.headers["x-csrf-token"]).toBe("csrf");
  expect(xhr!.headers["content-type"]).toBeUndefined();
  xhr!.upload.onprogress!({ loaded: 10, total: 10, lengthComputable: true });
  xhr!.upload.onload!();
  expect(progress.at(-1)?.phase).toBe("processing");
  xhr!.onload!();
  expect((await promise).status).toBe(200);
  expect(progress.at(-1)?.phase).toBe("completed");
  const controller = new AbortController();
  const abortedRequest = new Request(request);
  Object.defineProperty(abortedRequest, "signal", { value: controller.signal });
  const aborted = uploadRequest(abortedRequest, body, vi.fn());
  controller.abort();
  await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
});
