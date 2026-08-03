import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { getFiles, getFolders } from "@features/files/api";
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
  return { ...actual, getFiles: vi.fn(), getFolders: vi.fn() };
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
  vi.mocked(getFiles).mockResolvedValue({ items: [imageFile] });
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
  expect(
    screen.getByText("参考音频 HTTPS URL（最多 3 个）"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("参考视频 HTTPS URL（最多 3 个）"),
  ).toBeInTheDocument();
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
