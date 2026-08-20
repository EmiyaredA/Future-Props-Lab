import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import {
  buildFrameFileName,
  formatFrameTimestamp,
  isAcceptedVideoFile,
  sanitizeExportBaseName,
} from "@features/tools/videoFrameExport";
import { VideoFrameExporterPage } from "@features/tools/VideoFrameExporterPage";

const drawImage = vi.fn();
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

function prepareVideo(video: HTMLVideoElement) {
  Object.defineProperties(video, {
    duration: { configurable: true, value: 65.25 },
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
    currentTime: { configurable: true, writable: true, value: 0 },
    paused: { configurable: true, value: true },
  });
  fireEvent.loadedMetadata(video);
}

async function uploadVideo(container: HTMLElement) {
  const user = userEvent.setup();
  const file = new File(["video"], "演示:片段.mp4", { type: "video/mp4" });
  await user.upload(screen.getByLabelText("选择视频文件"), file);
  const video = container.querySelector("video");
  expect(video).not.toBeNull();
  prepareVideo(video!);
  return { user, video: video! };
}

beforeEach(() => {
  createObjectURL.mockReset();
  createObjectURL
    .mockReturnValueOnce("blob:source-video")
    .mockReturnValue("blob:frame-preview");
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback, type) => callback(new Blob(["frame"], { type })),
  );
});

test("formats safe timestamped export file names", () => {
  expect(formatFrameTimestamp(3661.234)).toBe("01-01-01-234");
  expect(sanitizeExportBaseName("  demo:<frame>?  ")).toBe("demo--frame--");
  expect(sanitizeExportBaseName("\u0000\u0001")).toBe("video-frame");
  expect(buildFrameFileName("scene", "jpeg", 3.25, true)).toBe(
    "scene_00-00-03-250.jpg",
  );
  expect(buildFrameFileName("scene", "webp", 3.25, false)).toBe("scene.webp");
  expect(
    isAcceptedVideoFile(
      new File(["video"], "clip.mov", { type: "application/octet-stream" }),
    ),
  ).toBe(true);
});

test("uploads, seeks, previews and downloads an original-size frame", async () => {
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const { container } = render(<VideoFrameExporterPage onBack={vi.fn()} />);
  const { user, video } = await uploadVideo(container);

  expect(screen.getByText("01:05.250 · 1920 × 1080")).toBeInTheDocument();
  expect(
    screen.getByText("演示-片段-frame_00-00-00-000.png"),
  ).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("视频时间点"), {
    target: { value: "3.25" },
  });
  expect(video.currentTime).toBe(3.25);
  fireEvent.seeked(video);

  await user.click(screen.getByRole("button", { name: "生成预览" }));
  expect(await screen.findByAltText("当前导出视频帧预览")).toHaveAttribute(
    "src",
    "blob:frame-preview",
  );
  expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
  expect(
    screen.getByText("演示-片段-frame_00-00-03-250.png"),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "下载图片" }));
  expect(click).toHaveBeenCalledOnce();
  expect(await screen.findByText(/已下载 演示-片段-frame/)).toBeInTheDocument();
});

test("invalidates the preview when format or quality changes", async () => {
  const { container } = render(<VideoFrameExporterPage onBack={vi.fn()} />);
  const { user } = await uploadVideo(container);
  await user.click(screen.getByRole("button", { name: "生成预览" }));
  expect(await screen.findByText("已生成")).toBeInTheDocument();

  await user.click(screen.getByRole("combobox", { name: "选择图片格式" }));
  await user.click(screen.getByRole("option", { name: /JPEG/ }));
  expect(screen.getByLabelText("图片质量")).toHaveValue("92");
  expect(screen.getByText(/设置或时间点已变化/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载图片" })).toBeDisabled();

  fireEvent.change(screen.getByLabelText("图片质量"), {
    target: { value: "80" },
  });
  await user.click(screen.getByRole("button", { name: "生成预览" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "下载图片" })).toBeEnabled(),
  );
});

test("rejects non-video files and reports image encoding failures", async () => {
  const user = userEvent.setup();
  const firstRender = render(<VideoFrameExporterPage onBack={vi.fn()} />);
  const input = screen.getByLabelText("选择视频文件");
  fireEvent.change(input, {
    target: {
      files: [new File(["text"], "notes.txt", { type: "text/plain" })],
    },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "请选择常见视频文件",
  );

  firstRender.unmount();
  const { container } = render(<VideoFrameExporterPage onBack={vi.fn()} />);
  const { video } = await uploadVideo(container);
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(
    (callback) => callback(null),
  );
  fireEvent.seeked(video);
  await user.click(screen.getByRole("button", { name: "生成预览" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "当前浏览器无法生成所选图片格式",
  );
});

test("releases local URLs when replacing the video and unmounting", async () => {
  const { container, unmount } = render(
    <VideoFrameExporterPage onBack={vi.fn()} />,
  );
  const { user } = await uploadVideo(container);
  await user.click(screen.getByRole("button", { name: "生成预览" }));
  await screen.findByAltText("当前导出视频帧预览");
  await user.click(screen.getByRole("button", { name: "更换视频" }));
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:frame-preview");
  unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:source-video");
});
