import { beforeEach, expect, test, vi } from "vitest";
import {
  ApiError,
  fetchApiJson,
  requestApi,
} from "@platform/api/client";
import {
  AUTH_REQUIRED_EVENT,
  WORKSPACE_CHANGED_EVENT,
} from "@platform/api/studioAuth";

beforeEach(() => {
  document.cookie = "fpl_csrf=test-csrf; path=/";
  vi.restoreAllMocks();
});

test("sends multipart requests with session CSRF and browser content type", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const form = new FormData();
  form.append("upload", new Blob(["asset"]), "asset.txt");

  await expect(
    fetchApiJson<{ ok: boolean }>("/v1/assets", {
      method: "POST",
      body: form,
    }),
  ).resolves.toEqual({ ok: true });

  const request = fetchMock.mock.calls[0]![0] as Request;
  expect(request.credentials).toBe("include");
  expect(request.headers.get("X-CSRF-Token")).toBe("test-csrf");
  expect(request.headers.get("Content-Type")).toBeNull();
});

test("notifies authentication and maps non-JSON failures to ApiError", async () => {
  const notified = vi.fn();
  window.addEventListener(AUTH_REQUIRED_EVENT, notified, { once: true });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("unauthorized", { status: 401 }),
  );

  await expect(requestApi("/v1/private")).rejects.toMatchObject({
    name: "Error",
    status: 401,
    message: "请求失败，请稍后重试",
  } satisfies Partial<ApiError>);
  expect(notified).toHaveBeenCalledTimes(1);
});

test("notifies when workspace access changes", async () => {
  const notified = vi.fn();
  window.addEventListener(WORKSPACE_CHANGED_EVENT, notified, { once: true });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        code: "workspace_access_changed",
        detail: "Workspace 权限已变化",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    ),
  );

  await expect(requestApi("/v1/private")).rejects.toBeInstanceOf(ApiError);
  expect(notified).toHaveBeenCalledTimes(1);
});
