import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { VideoOutputPreview } from "@features/visual-workshop/board/VideoOutputPreview";
import { getVideoMediaInfo } from "@features/visual-workshop/api";

vi.mock("@features/visual-workshop/api", async (original) => ({
  ...(await original<typeof import("@features/visual-workshop/api")>()),
  getVideoMediaInfo: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: (path: string) => ({ url: `blob:${path}`, error: null }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVideoMediaInfo).mockImplementation(async (id) => ({
    container: id === "original" ? "MP4" : "WebM",
    codec: id === "original" ? "h264" : "vp9",
    pixel_format: "yuv420p",
    alpha_channel: id === "original" ? "absent" : "present",
  }));
});
function setup(inspection?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Preview() {
    const [background, setBackground] = useState("#000000");
    return (
      <VideoOutputPreview
        assetId="original"
        inspectionAssetId={inspection}
        background={background}
        onBackgroundChange={setBackground}
      />
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <Preview />
    </QueryClientProvider>,
  );
}
test("switching preview colours keeps the same video and playback position", async () => {
  const user = userEvent.setup();
  setup("inspection");
  await screen.findByText("检查视频：WebM · VP9 · 含透明通道");
  expect(screen.getByText("原输出：MP4 · H264 · 无透明通道")).toBeVisible();
  const video = screen.getByLabelText("输出视频预览") as HTMLVideoElement;
  video.currentTime = 4.2;
  const src = video.src;
  await user.click(screen.getByRole("button", { name: "白色背景" }));
  expect(video).toHaveStyle({ backgroundColor: "#FFFFFF" });
  expect(video.currentTime).toBe(4.2);
  expect(video.src).toBe(src);
  expect(screen.getByLabelText("输出视频预览")).toBe(video);
  await user.click(screen.getByRole("button", { name: "自定义预览背景" }));
  const input = screen.getByLabelText("自定义预览背景十六进制值");
  await user.clear(input);
  await user.type(input, "#123456{Enter}");
  expect(video).toHaveStyle({ backgroundColor: "#123456" });
  expect(video.currentTime).toBe(4.2);
  expect(getVideoMediaInfo).toHaveBeenCalledTimes(2);
});
test("inspection decode errors require an explicit switch to canonical MP4", async () => {
  setup("inspection");
  fireEvent.error(screen.getByLabelText("输出视频预览"));
  expect(screen.getByRole("alert")).toHaveTextContent("透明检查视频不可播放");
  await userEvent.click(screen.getByRole("button", { name: "查看原输出 MP4" }));
  expect(screen.getByLabelText("输出视频预览")).toHaveAttribute(
    "src",
    "blob:/v1/files/original/download",
  );
  expect(
    await screen.findByText("视频格式：MP4 · H264 · 无透明通道"),
  ).toBeVisible();
});
test("unreadable metadata stays unknown and can be retried", async () => {
  vi.mocked(getVideoMediaInfo).mockRejectedValueOnce(new Error("probe failed"));
  setup();
  expect(
    await screen.findByText(/格式信息暂不可用 · 透明通道未知/),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() =>
    expect(screen.getByText("视频格式：MP4 · H264 · 无透明通道")).toBeVisible(),
  );
});
