import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { getFiles, getFolders, uploadManagedFile } from "@features/files/api";
import { GenerationDrawer } from "@features/visual-workshop/GenerationDrawer";
import { VisualWorkshopTasksPage } from "@features/visual-workshop/VisualWorkshopTasksPage";
import {
  createGenerationTask,
  getGenerationOptions,
  getGenerationTasks,
  getVisualWorkshopProjects,
  retryGenerationMaterialization,
} from "@features/visual-workshop/api";
import { ProviderIcon } from "@shared/ui/ProviderIcon";

vi.mock("@features/files/api", async () => {
  const actual = await vi.importActual<typeof import("@features/files/api")>(
    "@features/files/api",
  );
  return {
    ...actual,
    getFiles: vi.fn(),
    getFolders: vi.fn(),
    uploadManagedFile: vi.fn(),
  };
});
vi.mock("@features/visual-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/visual-workshop/api")
  >("@features/visual-workshop/api");
  return {
    ...actual,
    createGenerationTask: vi.fn(),
    getGenerationOptions: vi.fn(),
    getGenerationTasks: vi.fn(),
    getVisualWorkshopProjects: vi.fn(),
    retryGenerationMaterialization: vi.fn(),
  };
});

const imageFile = {
  id: "asset-1",
  project_id: "project-1",
  folder_id: null,
  reference_id: null,
  original_filename: "reference.png",
  display_name: "参考图.png",
  media_kind: "image" as const,
  mime_type: "image/png",
  byte_size: 1024,
  source: "project" as const,
  is_reference: false,
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
};

const videoFile = {
  ...imageFile,
  id: "asset-video",
  original_filename: "reference.mp4",
  display_name: "参考视频.mp4",
  media_kind: "video" as const,
  mime_type: "video/mp4",
};

const audioFile = {
  ...imageFile,
  id: "asset-audio",
  original_filename: "reference.mp3",
  display_name: "参考音频.mp3",
  media_kind: "audio" as const,
  mime_type: "audio/mpeg",
};

const baseTask = {
  id: "task-12345678",
  project_id: "project-1",
  provider_id: "provider-image",
  model_id: "model-image",
  provider_kind: "senseaudio_image" as const,
  kind: "image" as const,
  provider_name: "SenseAudio 图片生成",
  model_slug: "senseaudio-image-2.0-260319",
  request_payload: { prompt: "电影感的未来城市" },
  provider_task_id: null,
  status: "queued" as const,
  progress: 0,
  error_message: null,
  result_asset_id: null,
  can_retry_materialization: false,
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
  completed_at: null,
};

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getGenerationOptions).mockResolvedValue({
    models: [
      {
        id: "model-image",
        provider_id: "provider-image",
        provider_name: "SenseAudio 图片生成",
        kind: "image",
        slug: "senseaudio-image-2.0-260319",
        label: "SenseAudio Image 2.0",
        description: "高清图片生成",
        sizes: ["1024x1024", "1536x864"],
      },
      {
        id: "model-video",
        provider_id: "provider-video",
        provider_name: "SenseAudio 视频生成",
        kind: "video",
        slug: "doubao-seedance-2-0-260128",
        label: "Doubao Seedance 2.0",
        description: "视频生成",
        sizes: [],
      },
    ],
  });
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockImplementation(async ({ mediaKind }) => ({
    items:
      mediaKind === "video"
        ? [videoFile]
        : mediaKind === "audio"
          ? [audioFile]
          : [imageFile],
  }));
  vi.mocked(uploadManagedFile).mockImplementation(async (file) =>
    file.type.startsWith("video/")
      ? videoFile
      : file.type.startsWith("audio/")
        ? audioFile
        : imageFile,
  );
  vi.mocked(createGenerationTask).mockResolvedValue(baseTask);
  vi.mocked(getVisualWorkshopProjects).mockResolvedValue({
    items: [
      {
        id: "project-1",
        title: "产品主视觉",
        kind: "canvas",
        status: "draft",
        revision: 0,
        created_at: "2026-08-03T08:00:00Z",
        updated_at: "2026-08-03T08:00:00Z",
      },
    ],
  });
  vi.mocked(getGenerationTasks).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(retryGenerationMaterialization).mockResolvedValue({
    ...baseTask,
    status: "processing",
  });
});

test("uses the local official SenseAudio logo", () => {
  const { container } = render(<ProviderIcon kind="senseaudio_image" />);
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/providers/senseaudio-logo.svg",
  );
});

test("creates an image task with model-linked sizes and a project reference", async () => {
  const user = userEvent.setup();
  renderWithClient(
    <GenerationDrawer projectId="project-1" onClose={vi.fn()} />,
  );
  expect(
    await screen.findByRole("option", { name: "SenseAudio Image 2.0" }),
  ).toBeInTheDocument();
  await user.type(
    screen.getByPlaceholderText("描述要生成的画面…"),
    "电影感的未来城市",
  );
  await user.click(await screen.findByRole("button", { name: /参考图.png/ }));
  await user.click(screen.getByRole("button", { name: "创建生成任务" }));
  await waitFor(() =>
    expect(createGenerationTask).toHaveBeenCalledWith("project-1", {
      kind: "image",
      model_id: "model-image",
      prompt: "电影感的未来城市",
      size: "1024x1024",
      seed: null,
      reference_asset_id: "asset-1",
    }),
  );
  expect(await screen.findByText(/任务已提交/)).toBeInTheDocument();
});

test("uses the compact video node composer for image-to-video tasks", async () => {
  vi.mocked(createGenerationTask).mockResolvedValueOnce({
    ...baseTask,
    kind: "video",
    provider_id: "provider-video",
    model_id: "model-video",
    provider_kind: "senseaudio_video",
    provider_name: "SenseAudio 视频生成",
    model_slug: "doubao-seedance-2-0-260128",
  });
  const user = userEvent.setup();
  const { container } = renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="video"
      projectId="project-1"
      onClose={vi.fn()}
    />,
  );

  const compactModelMenu = await screen.findByRole("button", {
    name: "生成模型",
  });
  await waitFor(() =>
    expect(compactModelMenu).toHaveTextContent("Doubao Seedance 2.0"),
  );
  await user.click(screen.getByText("16:9 · 5S · 720P"));
  const parameterPopover = container.querySelector(".video-parameter-popover");
  expect(parameterPopover).toBeInTheDocument();
  expect(parameterPopover?.querySelector("select")).toBeNull();
  expect(
    parameterPopover?.querySelectorAll(".video-parameter-select"),
  ).toHaveLength(2);
  const durationSlider = screen.getByRole("slider", { name: "时长" });
  expect(durationSlider).toHaveAttribute("min", "4");
  expect(durationSlider).toHaveAttribute("max", "15");
  fireEvent.change(durationSlider, { target: { value: "8" } });
  await user.click(screen.getByRole("button", { name: "清晰度" }));
  await user.click(screen.getByRole("option", { name: "1080P" }));
  await user.click(screen.getByRole("button", { name: "画面比例" }));
  await user.click(screen.getByRole("option", { name: "9:16" }));
  expect(screen.getByText("9:16 · 8S · 1080P")).toBeInTheDocument();
  expect(
    screen.getByRole("navigation", { name: "视频生成方式" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "图生视频" }));
  const startFramePicker = screen
    .getByRole("group", { name: "选择起始画面" })
    .querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(
    startFramePicker,
    new File(["image"], "local.png", { type: "image/png" }),
  );
  await user.type(
    screen.getByPlaceholderText("描述您的修改或生成需求…"),
    "镜头缓慢推进",
  );
  await user.click(screen.getByRole("button", { name: "生成视频" }));

  await waitFor(() =>
    expect(createGenerationTask).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        kind: "video",
        mode: "frames",
        first_frame_asset_id: "asset-1",
        last_frame_asset_id: null,
        prompt: "镜头缓慢推进",
      }),
    ),
  );
});

test("shows the official video modes and conditional reference fields", async () => {
  const user = userEvent.setup();
  renderWithClient(
    <GenerationDrawer projectId="project-1" onClose={vi.fn()} />,
  );
  await user.click(await screen.findByRole("tab", { name: "视频" }));
  expect(
    screen.getByRole("option", { name: "Doubao Seedance 2.0" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "首尾帧" }));
  expect(screen.getByText("首帧（必选）")).toBeInTheDocument();
  expect(screen.getByText("尾帧（可选）")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "参考素材" }));
  expect(screen.getByText("参考音频")).toBeInTheDocument();
  expect(screen.getByText("参考视频")).toBeInTheDocument();
  expect(screen.queryByText(/HTTPS URL/)).not.toBeInTheDocument();
});

test("uploads local reference media, auto-selects it and submits asset ids", async () => {
  vi.mocked(createGenerationTask).mockResolvedValueOnce({
    ...baseTask,
    kind: "video",
    provider_id: "provider-video",
    model_id: "model-video",
    provider_kind: "senseaudio_video",
    provider_name: "SenseAudio 视频生成",
    model_slug: "doubao-seedance-2-0-260128",
  });
  const user = userEvent.setup();
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="video"
      projectId="project-1"
      onClose={vi.fn()}
    />,
  );
  const modelMenu = await screen.findByRole("button", { name: "生成模型" });
  await waitFor(() =>
    expect(modelMenu).toHaveTextContent("Doubao Seedance 2.0"),
  );
  await user.click(modelMenu);
  expect(
    screen.getByRole("option", { name: "Doubao Seedance 2.0" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "全能参考" }));
  expect(screen.queryByText(/已选 0\//)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "上传参考图片" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "上传参考视频" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "上传参考音频" }),
  ).toBeInTheDocument();

  const videoPicker = screen.getByText("参考视频").closest("fieldset");
  const audioPicker = screen.getByText("参考音频").closest("fieldset");
  await user.upload(
    videoPicker!.querySelector('input[type="file"]')!,
    new File(["video"], "local.mp4", { type: "video/mp4" }),
  );
  await user.upload(
    audioPicker!.querySelector('input[type="file"]')!,
    new File(["audio"], "local.mp3", { type: "audio/mpeg" }),
  );
  await user.click(screen.getByRole("button", { name: "生成视频" }));

  await waitFor(() =>
    expect(createGenerationTask).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        reference_asset_ids: [],
        video_asset_ids: ["asset-video"],
        audio_asset_ids: ["asset-audio"],
      }),
    ),
  );
});

test("renders task progress and retries only local materialization failures", async () => {
  vi.mocked(getGenerationTasks).mockResolvedValue({
    items: [
      {
        ...baseTask,
        status: "processing",
        progress: 48,
      },
      {
        ...baseTask,
        id: "task-failed",
        status: "failed",
        progress: 100,
        error_message: "结果下载超时",
        can_retry_materialization: true,
      },
    ],
    total: 2,
  });
  const user = userEvent.setup();
  renderWithClient(
    <VisualWorkshopTasksPage onOpenProject={vi.fn()} onOpenAssets={vi.fn()} />,
  );
  expect(await screen.findByText("48%")).toBeInTheDocument();
  expect(screen.getByText("结果下载超时")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重试保存" }));
  await waitFor(() =>
    expect(retryGenerationMaterialization).toHaveBeenCalled(),
  );
  expect(vi.mocked(retryGenerationMaterialization).mock.calls[0]?.[0]).toBe(
    "task-failed",
  );
});
