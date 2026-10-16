import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "@platform/api/client";
import { applyVideoEditorOperations } from "@features/video-editor/api";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@platform/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@platform/api/client")>()),
  api: { POST: post },
}));
const requestId = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("aborts a stalled save and reports an unconfirmed result without retrying", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  post.mockImplementation(
    (_path: string, options: { signal?: AbortSignal }) => {
      signal = options?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal?.reason), {
          once: true,
        });
      });
    },
  );
  const saved = applyVideoEditorOperations("p", 4, [], requestId);
  const rejected = expect(saved).rejects.toMatchObject({
    message: expect.stringContaining("结果尚未确认"),
    problem: { code: "save_confirmation_timeout" },
  });
  await vi.advanceTimersByTimeAsync(29_999);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(signal?.aborted).toBe(true);
  expect(post).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("clears the deadline after a successful save and preserves request identity", async () => {
  vi.useFakeTimers();
  const data = { revision: 5 };
  post.mockResolvedValue({
    data,
    response: new Response(null, { status: 200 }),
  });
  await expect(
    applyVideoEditorOperations("p", 4, [], requestId),
  ).resolves.toEqual(data);
  expect(post).toHaveBeenCalledWith(
    "/v1/video-editor/projects/{project_id}/timeline/operations",
    expect.objectContaining({
      params: { path: { project_id: "p" } },
      body: { expectedRevision: 4, requestId, operations: [] },
    }),
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves server errors and clears their deadline", async () => {
  vi.useFakeTimers();
  post.mockResolvedValue({
    error: { code: "revision_conflict", detail: "revision conflict" },
    response: new Response(null, { status: 409 }),
  });
  await expect(
    applyVideoEditorOperations("p", 4, [], requestId),
  ).rejects.toBeInstanceOf(ApiError);
  expect(vi.getTimerCount()).toBe(0);
});
