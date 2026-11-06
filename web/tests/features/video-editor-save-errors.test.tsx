import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApiError } from "@platform/api/client";
import { useVideoEditor } from "@features/video-editor/useVideoEditor";
import {
  applyVideoEditorOperations,
  getVideoEditorTimeline,
} from "@features/video-editor/api";

vi.mock("@features/video-editor/api", () => ({
  applyVideoEditorOperations: vi.fn(),
  getVideoEditorTimeline: vi.fn(),
  getVideoEditorProject: vi.fn().mockResolvedValue({ id: "save-errors" }),
  listVideoEditorAssets: vi.fn().mockResolvedValue({ items: [] }),
  patchVideoEditorProject: vi.fn(),
}));

it.each([
  [
    new ApiError(
      "转场长度不能超过相邻 Clip",
      { code: "transition_too_long" },
      422,
    ),
    "转场长度不能超过相邻 Clip",
  ],
  [
    new ApiError("revision conflict", { code: "revision_conflict" }, 409),
    "服务器版本已更新",
  ],
  [new Error("network offline"), "保存失败；"],
])(
  "preserves a failed edit and explains the save error: %s",
  async (error, message) => {
    vi.mocked(getVideoEditorTimeline).mockResolvedValue({
      projectId: "save-errors",
      revision: 0,
      updatedAt: "now",
      document: {
        schemaVersion: "1.0",
        settings: {
          videoFitPolicyVersion: 1,
          width: 1920,
          height: 1080,
          fps: 30,
          backgroundColor: "#000000",
        },
        tracks: [],
      },
    });
    vi.mocked(applyVideoEditorOperations).mockRejectedValue(error);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, unmount } = renderHook(
      () => useVideoEditor("save-errors"),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.timeline.data).toBeDefined());
    await act(async () => {
      await expect(
        result.current.commit([{ type: "updateSettings", patch: { fps: 60 } }]),
      ).rejects.toBe(error);
    });
    expect(result.current.notice).toContain(message);
    expect(result.current.failedSaves).toBe(1);
    expect(result.current.saving).toBe(true);
    unmount();
    client.clear();
  },
);
