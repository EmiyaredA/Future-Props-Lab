import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { fetchApiBlob } from "@platform/api/client";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import type {
  TransferProgress,
  TransferRequestInit,
} from "@platform/api/transfer";

vi.mock("@platform/api/client", () => ({ fetchApiBlob: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("path and account-context changes abort old reads and discard their late progress/bytes", async () => {
  const createObjectURL = vi.fn(() => "blob:current");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const requests: Array<{
    resolve: (value: Blob) => void;
    options: TransferRequestInit;
  }> = [];
  vi.mocked(fetchApiBlob).mockImplementation(
    (_path, options = {}) =>
      new Promise((resolve) => requests.push({ resolve, options })),
  );
  const { result, rerender, unmount } = renderHook(
    ({ path }) => useApiBlobUrl(path),
    { initialProps: { path: "/v1/files/a/content" } },
  );
  await waitFor(() => expect(requests).toHaveLength(1));
  const progress: TransferProgress = {
    direction: "download",
    phase: "transferring",
    loaded: 100,
    total: 200,
    bytesPerSecond: 50,
  };
  act(() => requests[0]!.options.onProgress?.(progress));
  expect(result.current.progress?.loaded).toBe(100);
  rerender({ path: "/v1/files/b/content" });
  expect(requests[0]!.options.signal?.aborted).toBe(true);
  expect(result.current.url).toBe("");
  expect(result.current.progress).toBeUndefined();
  await act(async () => {
    requests[0]!.options.onProgress?.({ ...progress, loaded: 200 });
    requests[0]!.resolve(new Blob(["stale"]));
  });
  expect(createObjectURL).not.toHaveBeenCalled();
  await act(async () => requests[1]!.resolve(new Blob(["current"])));
  expect(result.current.url).toBe("blob:current");
  unmount();
  expect(requests[1]!.options.signal?.aborted).toBe(true);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:current");
});
