import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoEnhancementPanel } from "@features/models/video-enhancement/VideoEnhancementPanel";
import { api } from "@platform/api/client";

vi.mock("@platform/api/client", () => ({
  api: { GET: vi.fn(), POST: vi.fn() },
  unwrap: (value: { data: unknown }) => value.data,
}));

describe("local video enhancement", () => {
  it.each([
    ["local_relayvsr", "RelayVSR", "AI 增强"],
    ["local_ffmpeg", "FFmpeg", "轻微锐化"],
  ])(
    "exposes finished segments while %s continues processing",
    async (providerKind, label, enhancedLabel) => {
      const root = "/v1/model-inference/video-enhancements";
      const task = {
        id: "task",
        model_id: "relay",
        filename: "test.mp4",
        status: "running",
        completed: 1,
        revision: 4,
        result_url: null,
        error_message: null,
        segments: [
          {
            index: 0,
            start_seconds: 0,
            end_seconds: 2,
            result_url: `${root}/task/segments/0/enhanced`,
            original_url: `${root}/task/segments/0/original`,
          },
          {
            index: 1,
            start_seconds: 2,
            end_seconds: 4,
            result_url: null,
            original_url: null,
          },
        ],
      };
      (api.GET as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [task],
      } as never);
      (api.POST as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { ...task, status: "paused" },
      } as never);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const view = render(
        <QueryClientProvider client={client}>
          <VideoEnhancementPanel
            models={[
              {
                value: "relay",
                label,
                description: "本地",
                providerKind,
                capabilities: ["video_enhancement"],
              },
            ]}
            modelId="relay"
            onSelectMode={vi.fn()}
            onSelectModel={vi.fn()}
          />
        </QueryClientProvider>,
      );

      const compare = await screen.findByRole("button", { name: "对比预览" });
      expect(screen.getByRole("status")).toHaveTextContent("1/2 段");
      expect(screen.queryByText("下载 1080p 整片")).toBeNull();
      fireEvent.click(compare);
      expect(screen.getByText("原片等比缩放")).toBeInTheDocument();
      expect(screen.getByText(enhancedLabel)).toBeInTheDocument();
      expect(
        [...view.container.querySelectorAll("video")].map((video) =>
          video.getAttribute("src"),
        ),
      ).toEqual([task.segments[0].original_url, task.segments[0].result_url]);
      expect(
        screen.getByRole("slider", { name: "对比播放进度" }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^暂停$/ }));
      await waitFor(() =>
        expect(api.POST).toHaveBeenCalledWith(`${root}/{task_id}/actions`, {
          params: { path: { task_id: task.id } },
          body: { action: "pause", expected_revision: 4 },
        }),
      );
      client.clear();
    },
  );
});
