import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { getFiles, getFolders, type ManagedFile } from "@features/files";
import { CanvasMediaPreviewDialog } from "@features/visual-workshop/canvas/CanvasMediaPreviewDialog";
import {
  getGenerationTasks,
  type GenerationTask,
  type VisualCanvasNode,
} from "@features/visual-workshop/api";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";

vi.mock("@features/files", async () => {
  const actual =
    await vi.importActual<typeof import("@features/files")>("@features/files");
  return { ...actual, getFiles: vi.fn(), getFolders: vi.fn() };
});
vi.mock("@features/visual-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/visual-workshop/api")
  >("@features/visual-workshop/api");
  return { ...actual, getGenerationTasks: vi.fn() };
});
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: vi.fn(),
}));

const file = (
  id: string,
  mediaKind: ManagedFile["media_kind"],
): ManagedFile => ({
  id,
  project_id: "project-1",
  folder_id: null,
  reference_id: null,
  original_filename: `${id}.${mediaKind === "image" ? "png" : mediaKind === "video" ? "mp4" : "mp3"}`,
  display_name: `${id}素材`,
  media_kind: mediaKind,
  mime_type:
    mediaKind === "image"
      ? "image/png"
      : mediaKind === "video"
        ? "video/mp4"
        : "audio/mpeg",
  byte_size: 2048,
  source: "project",
  is_reference: false,
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
});

const task = (
  id: string,
  overrides: Partial<GenerationTask> = {},
): GenerationTask => ({
  id,
  project_id: "project-1",
  canvas_node_id: "image-node",
  provider_id: "provider-1",
  model_id: "model-1",
  provider_kind: "senseaudio_image",
  kind: "image",
  provider_name: "SenseAudio",
  model_slug: "image-pro",
  request_payload: { prompt: "雨夜里的霓虹城市" },
  provider_task_id: null,
  status: "completed",
  progress: 100,
  error_message: null,
  result_asset_id: `asset-${id}`,
  can_retry_materialization: false,
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:01:00Z",
  completed_at: "2026-08-03T08:01:00Z",
  ...overrides,
});

function renderDialog(
  node: Exclude<VisualCanvasNode, { kind: "text" }>,
  options: { onClose?: () => void; onSetCurrent?: () => void } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = options.onClose ?? vi.fn();
  const onSetCurrent = options.onSetCurrent ?? vi.fn();
  const result = render(
    <QueryClientProvider client={client}>
      <CanvasMediaPreviewDialog
        projectId="project-1"
        node={node}
        onClose={onClose}
        onSetCurrent={onSetCurrent}
      />
    </QueryClientProvider>,
  );
  return { ...result, onClose, onSetCurrent };
}

beforeEach(() => {
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockResolvedValue({
    items: [
      file("current", "video"),
      file("asset-old", "image"),
      file("asset-current", "image"),
      file("audio-current", "audio"),
    ],
  });
  vi.mocked(getGenerationTasks).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(useApiBlobUrl).mockImplementation((path) =>
    path?.includes("missing-reference")
      ? { url: "", error: new Error("missing"), loading: false }
      : { url: path ? `blob:${path}` : "", error: null, loading: false },
  );
});

test("shows uploaded video in a fixed dialog without autoplay and restores close behavior", async () => {
  const onClose = vi.fn();
  const { container } = renderDialog(
    {
      id: "video-node",
      kind: "video",
      title: "上传镜头",
      position: { x: 0, y: 0 },
      asset_id: "current",
    },
    { onClose },
  );

  expect(await screen.findByRole("dialog", { name: "上传镜头" })).toBeVisible();
  expect(screen.getByText("非 AI 生成素材")).toBeInTheDocument();
  const video = container.ownerDocument.querySelector("video")!;
  expect(video).toHaveAttribute("controls");
  expect(video).not.toHaveAttribute("autoplay");
  expect(document.body.style.overflow).toBe("hidden");
  expect(
    screen.getByRole("link", { name: "下载当前预览素材" }),
  ).toHaveAttribute(
    "href",
    "/v1/files/current/download?download_name=%E4%B8%8A%E4%BC%A0%E9%95%9C%E5%A4%B4",
  );

  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("switches generation history without saving until explicitly confirmed", async () => {
  const current = task("current", { result_asset_id: "asset-current" });
  const failed = task("failed", {
    status: "failed",
    progress: 100,
    error_message: "供应商处理失败",
    result_asset_id: null,
    completed_at: null,
  });
  const processing = task("processing", {
    status: "processing",
    progress: 42,
    result_asset_id: null,
    completed_at: null,
  });
  const old = task("old", {
    result_asset_id: "asset-old",
    request_payload: {
      prompt: "雨夜里的霓虹城市",
      reference_asset_ids: ["missing-reference"],
      size: "1536x864",
    },
  });
  vi.mocked(getGenerationTasks).mockResolvedValue({
    items: [processing, failed, old, current],
    total: 4,
  });
  const onSetCurrent = vi.fn();
  renderDialog(
    {
      id: "image-node",
      kind: "image",
      title: "主视觉",
      position: { x: 0, y: 0 },
      asset_id: "asset-current",
      generation_task_id: "current",
    },
    { onSetCurrent },
  );

  const dialog = await screen.findByRole("dialog", { name: "主视觉" });
  expect(await screen.findByText("4 条")).toBeInTheDocument();
  const history = within(dialog).getByText("生成历史").closest("footer")!;
  await userEvent.click(within(history).getByRole("button", { name: "3" }));
  expect(screen.getByText("雨夜里的霓虹城市")).toBeInTheDocument();
  expect(screen.getByText("缺失")).toBeInTheDocument();
  expect(onSetCurrent).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "设为当前素材" }));
  expect(onSetCurrent).toHaveBeenCalledWith("asset-old", "old");

  await userEvent.click(within(history).getByRole("button", { name: "2" }));
  expect(screen.getByText("供应商处理失败")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "设为当前素材" })).toBeNull();
});

test("renders an audio node with native controls", async () => {
  renderDialog({
    id: "audio-node",
    kind: "audio",
    title: "环境声",
    position: { x: 0, y: 0 },
    asset_id: "audio-current",
  });

  expect(await screen.findByText("音频预览")).toBeInTheDocument();
  expect(document.querySelector("audio")).toHaveAttribute("controls");
});
