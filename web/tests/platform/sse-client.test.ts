import { ApiError } from "@platform/api/client";
import { postSse } from "@platform/api/sse";
import { AUTH_REQUIRED_EVENT, getCsrfToken } from "@platform/api/studioAuth";

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "fpl_csrf=; Max-Age=0; Path=/";
});

describe("postSse", () => {
  test("parses split chunks, CRLF, multiline data, comments and a trailing frame", async () => {
    const events: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            ": keep-alive\r\n\r\nda",
            'ta: {"type":"delta",\r\ndata: "payload":{"text":"A"}}\r\n\r\n',
            'data: {"type":"done","payload":{}}',
          ]),
        ),
    );

    await postSse({
      path: "/v1/test/stream",
      body: { prompt: "hello" },
      signal: new AbortController().signal,
      onEvent: (event: Record<string, unknown>) => events.push(event),
      defaultErrorMessage: "请求失败",
    });

    expect(events).toEqual([
      { type: "delta", payload: { text: "A" } },
      { type: "done", payload: {} },
    ]);
  });

  test("sends CSRF, cookie credentials and JSON headers", async () => {
    document.cookie = "fpl_csrf=csrf-token; Path=/";
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await postSse({
      path: "/v1/test/stream",
      body: { value: 1 },
      signal: new AbortController().signal,
      onEvent: () => undefined,
      defaultErrorMessage: "请求失败",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/test/stream",
      expect.objectContaining({
        method: "POST",
        body: '{"value":1}',
        headers: expect.objectContaining({
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-token",
        }),
        credentials: "include",
      }),
    );
  });

  test("normalizes structured API errors and notifies on 401", async () => {
    const authRequired = vi.fn();
    window.addEventListener(AUTH_REQUIRED_EVENT, authRequired);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "studio_auth_required",
            detail: { message: "管理令牌无效" },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      postSse({
        path: "/v1/test/stream",
        body: {},
        signal: new AbortController().signal,
        onEvent: () => undefined,
        defaultErrorMessage: "请求失败",
      }),
    ).rejects.toMatchObject({
      message: "管理令牌无效",
      status: 401,
    });
    expect(authRequired).toHaveBeenCalledOnce();
    expect(getCsrfToken()).toBe("");
    window.removeEventListener(AUTH_REQUIRED_EVENT, authRequired);
  });

  test("uses the fallback for non-JSON failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("upstream down", { status: 502 })),
    );
    await expect(
      postSse({
        path: "/v1/test/stream",
        body: {},
        signal: new AbortController().signal,
        onEvent: () => undefined,
        defaultErrorMessage: "对话请求失败",
      }),
    ).rejects.toMatchObject({ message: "对话请求失败", status: 502 });
  });

  test("reports a missing response stream and invalid JSON as ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 })),
    );
    await expect(
      postSse({
        path: "/v1/test/stream",
        body: {},
        signal: new AbortController().signal,
        onEvent: () => undefined,
        defaultErrorMessage: "请求失败",
      }),
    ).rejects.toBeInstanceOf(ApiError);

    vi.mocked(fetch).mockResolvedValueOnce(sseResponse(["data: not-json\n\n"]));
    await expect(
      postSse({
        path: "/v1/test/stream",
        body: {},
        signal: new AbortController().signal,
        onEvent: () => undefined,
        defaultErrorMessage: "请求失败",
      }),
    ).rejects.toMatchObject({
      message: "流式响应格式无效",
      problem: { code: "invalid_sse_event" },
    });
  });

  test("preserves AbortError from fetch", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }),
    );
    const request = postSse({
      path: "/v1/test/stream",
      body: {},
      signal: controller.signal,
      onEvent: () => undefined,
      defaultErrorMessage: "请求失败",
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
