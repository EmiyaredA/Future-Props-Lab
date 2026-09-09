import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import {
  getFiles,
  getFolders,
  importManagedFiles,
  uploadManagedFile,
} from "@features/files/api";
import { GenerationDrawer } from "@features/visual-workshop/generation/GenerationDrawer";
import { GenerationPromptEditor } from "@features/visual-workshop/generation/GenerationPromptEditor";
import type { PromptManagedFile } from "@features/visual-workshop/generation/generationPromptModel";
import { VisualWorkshopTasksPage } from "@features/visual-workshop/generation";
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
    importManagedFiles: vi.fn(),
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

const crossProjectFile = {
  ...imageFile,
  id: "cross-project-asset",
  project_id: "project-2",
  original_filename: "cross-project.png",
  display_name: "跨项目参考图.png",
};

const libraryFile = {
  ...imageFile,
  id: "library-asset",
  project_id: null,
  original_filename: "library.png",
  display_name: "公共参考图.png",
  source: "library" as const,
};

test("renders prompt asset blocks as bracketed project filenames", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <GenerationPromptEditor
      value=""
      assets={[
        {
          ...imageFile,
          original_filename: "codex-clipboard-source.png",
          display_name: "人设图1",
        },
      ]}
      label="图片提示词"
      placeholder="描述画面"
      onChange={onChange}
    />,
  );

  const promptEditor = screen.getByRole("textbox", { name: "图片提示词" });
  await user.type(promptEditor, "@");
  const mentionMenu = await screen.findByRole("listbox", {
    name: "引用已选素材",
  });
  expect(
    within(mentionMenu).getByRole("option", { name: /人设图1\.png/ }),
  ).toBeInTheDocument();
  await user.keyboard("{Enter}");

  expect(promptEditor).toHaveTextContent("人设图1.png");
  await waitFor(() => expect(onChange).toHaveBeenCalledWith("[人设图1.png]"));
});

test("hydrates legacy prompt text into a renamed asset block after assets load", async () => {
  const onChange = vi.fn();
  const { container, rerender } = render(
    <GenerationPromptEditor
      value="[reference.mp4] 参考运镜"
      assets={[]}
      label="视频提示词"
      placeholder="描述画面"
      onChange={onChange}
    />,
  );

  expect(container.querySelector(".generation-prompt-asset")).toBeNull();
  rerender(
    <GenerationPromptEditor
      value="[reference.mp4] 参考运镜"
      assets={[
        {
          ...videoFile,
          prompt_reference_name: "开局.mp4",
          prompt_legacy_names: ["reference.mp4"],
        } as PromptManagedFile,
      ]}
      label="视频提示词"
      placeholder="描述画面"
      onChange={onChange}
    />,
  );

  await waitFor(() =>
    expect(
      container.querySelector(".generation-prompt-asset"),
    ).toHaveTextContent("开局.mp4"),
  );
  expect(onChange).toHaveBeenCalledWith("[开局.mp4] 参考运镜");
});

const baseTask = {
  id: "task-12345678",
  project_id: "project-1",
  canvas_node_id: null,
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
  vi.mocked(getFiles).mockImplementation(async ({ mediaKind, projectId }) => ({
    items:
      mediaKind === "video"
        ? [videoFile]
        : mediaKind === "audio"
          ? [audioFile]
          : projectId === "project-2"
            ? [crossProjectFile]
            : projectId === undefined
              ? [libraryFile]
              : [imageFile],
  }));
  vi.mocked(importManagedFiles).mockImplementation(
    async (projectId, options) => ({
      items:
        options.sourceScope === "library"
          ? [
              {
                ...libraryFile,
                project_id: projectId,
                is_reference: true,
                reference_id: "library-reference",
              },
            ]
          : [
              {
                ...crossProjectFile,
                id: "copied-project-asset",
                project_id: projectId,
              },
            ],
    }),
  );
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
        is_official: false,
        id: "project-1",
        title: "产品主视觉",
        kind: "canvas",
        status: "draft",
        revision: 0,
        created_at: "2026-08-03T08:00:00Z",
        updated_at: "2026-08-03T08:00:00Z",
      },
      {
        is_official: false,
        id: "project-2",
        title: "其他视觉项目",
        kind: "canvas",
        status: "draft",
        revision: 0,
        created_at: "2026-08-02T08:00:00Z",
        updated_at: "2026-08-02T08:00:00Z",
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
  const { container } = renderWithClient(
    <GenerationDrawer projectId="project-1" onClose={vi.fn()} />,
  );
  const generationModel = await screen.findByRole("combobox", {
    name: "生成模型",
  });
  await waitFor(() =>
    expect(generationModel).toHaveTextContent("SenseAudio Image 2.0"),
  );
  await user.click(await screen.findByRole("button", { name: /参考图.png/ }));
  const promptEditor = screen.getByRole("textbox", { name: "图片提示词" });
  expect(promptEditor).toHaveAttribute("contenteditable", "true");
  expect(container.querySelector("textarea")).toBeNull();
  await user.type(promptEditor, "@");
  const mentionMenu = await screen.findByRole("listbox", {
    name: "引用已选素材",
  });
  expect(
    within(mentionMenu).getByRole("option", { name: /参考图\.png/ }),
  ).toBeInTheDocument();
  await user.keyboard("{Enter}");
  await user.type(promptEditor, " 电影感的未来城市");
  expect(
    screen.getByRole("button", { name: "移除引用 参考图.png" }),
  ).toBeInTheDocument();
  expect(promptEditor).toHaveTextContent("参考图.png 电影感的未来城市");
  const promptAsset = container.querySelector<HTMLElement>(
    ".generation-prompt-asset",
  )!;
  fireEvent.mouseUp(promptAsset);
  const setClipboardText = vi.fn();
  fireEvent.copy(promptEditor, {
    clipboardData: { setData: setClipboardText },
  });
  expect(setClipboardText).toHaveBeenCalledWith("text/plain", "[参考图.png]");
  await user.click(screen.getByRole("button", { name: "创建生成任务" }));
  await waitFor(() =>
    expect(createGenerationTask).toHaveBeenCalledWith("project-1", {
      kind: "image",
      model_id: "model-image",
      prompt: "[参考图.png] 电影感的未来城市",
      size: "1024x1024",
      seed: null,
      reference_asset_id: "asset-1",
    }),
  );
  expect(await screen.findByText(/任务已提交/)).toBeInTheDocument();
});

test("uses the compact image node composer with reference, size, and seed controls", async () => {
  const user = userEvent.setup();
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="image"
      projectId="project-1"
      onClose={vi.fn()}
    />,
  );

  const modelMenu = await screen.findByRole("button", {
    name: "生成模型",
  });
  await waitFor(() =>
    expect(modelMenu).toHaveTextContent("SenseAudio Image 2.0"),
  );
  const imageParameters = screen.getByRole("button", { name: "图片参数" });
  expect(imageParameters).toHaveTextContent("1:1 / 1K");
  await user.click(screen.getByRole("button", { name: "展开图片生成器" }));
  expect(screen.getByRole("button", { name: "收起图片生成器" })).toBeVisible();

  const referencePicker = screen
    .getByRole("group", { name: "参考图片（可选）" })
    .querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(
    referencePicker,
    new File(["image"], "local.png", { type: "image/png" }),
  );
  const selectedReference = await screen.findByRole("button", {
    name: "参考图.png",
  });
  const uploadReference = screen.getByRole("button", {
    name: "上传参考图片（可选）",
  });
  expect(
    selectedReference.compareDocumentPosition(uploadReference) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const promptEditor = screen.getByRole("textbox", { name: "图片提示词" });
  expect(promptEditor).toHaveAttribute("contenteditable", "true");
  await user.type(promptEditor, "@");
  const mentionMenu = await screen.findByRole("listbox", {
    name: "引用已选素材",
  });
  expect(
    within(mentionMenu).getByRole("option", { name: /参考图\.png/ }),
  ).toBeInTheDocument();
  await user.keyboard("{Enter}");
  await user.type(promptEditor, " 电影感的未来城市");
  expect(
    screen.getByRole("button", { name: "移除引用 参考图.png" }),
  ).toBeInTheDocument();
  expect(promptEditor).toHaveTextContent("参考图.png 电影感的未来城市");
  await user.click(imageParameters);
  await user.click(screen.getByRole("button", { name: "比例 16:9" }));
  expect(screen.getByRole("button", { name: "清晰度 1K" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "清晰度 2K" })).toBeDisabled();
  await user.type(screen.getByRole("spinbutton", { name: /种子/ }), "42");
  await user.click(screen.getByRole("button", { name: "生成数量" }));
  await user.click(screen.getByRole("option", { name: "×3" }));
  const callsBeforeSubmit = vi.mocked(createGenerationTask).mock.calls.length;
  await user.click(screen.getByRole("button", { name: "生成图片" }));

  await waitFor(() =>
    expect(createGenerationTask).toHaveBeenCalledTimes(callsBeforeSubmit + 3),
  );
  expect(createGenerationTask).toHaveBeenLastCalledWith("project-1", {
    kind: "image",
    model_id: "model-image",
    prompt: "[参考图.png] 电影感的未来城市",
    size: "1536x864",
    seed: 42,
    reference_asset_id: "asset-1",
  });
  expect(await screen.findByText(/已提交 3 个生成任务/)).toBeInTheDocument();
});

test("locks linked references, deduplicates manual selection, and consumes capacity", async () => {
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="image"
      projectId="project-1"
      linkedAssetIds={{ image: ["asset-1"], video: [], audio: [] }}
      draft={{
        model_id: "model-image",
        prompt: "",
        size: "1024x1024",
        seed: null,
        image_count: 1,
        reference_asset_id: "asset-1",
      }}
      onClose={vi.fn()}
    />,
  );

  const linkedReference = await screen.findByRole("button", {
    name: "参考图.png",
  });
  expect(screen.getAllByRole("button", { name: "参考图.png" })).toHaveLength(1);
  expect(linkedReference.closest(".generation-media-card")).toHaveAttribute(
    "data-linked-reference",
    "true",
  );
  expect(
    screen.queryByRole("button", { name: "移除参考文件 参考图.png" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "上传参考图片（可选）" }),
  ).toBeDisabled();
});

test("does not resolve prompt references from unselected project files", async () => {
  const user = userEvent.setup();
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="image"
      projectId="project-1"
      draft={{
        model_id: "model-image",
        prompt: "",
        size: "1024x1024",
        seed: null,
        image_count: 1,
        reference_asset_id: null,
      }}
      onClose={vi.fn()}
    />,
  );

  const promptEditor = await screen.findByRole("textbox", {
    name: "图片提示词",
  });
  await user.click(promptEditor);
  fireEvent.paste(promptEditor, {
    clipboardData: {
      getData: () =>
        "生成 [参考图.png] 并兼容旧格式 @[参考图.png] 并保持 @reference.png固定说明",
    },
  });

  expect(
    screen.queryByRole("button", { name: "移除引用 参考图.png" }),
  ).not.toBeInTheDocument();
  expect(promptEditor).toHaveTextContent(
    "生成 [参考图.png] 并兼容旧格式 @[参考图.png] 并保持 @reference.png固定说明",
  );

  await user.click(screen.getByRole("button", { name: "生成图片" }));

  await waitFor(() =>
    expect(createGenerationTask).toHaveBeenCalledWith("project-1", {
      kind: "image",
      model_id: "model-image",
      prompt:
        "生成 [参考图.png] 并兼容旧格式 @[参考图.png] 并保持 @reference.png固定说明",
      size: "1024x1024",
      seed: null,
      reference_asset_id: null,
    }),
  );
});

test("opens selected reference media from the card and only removes it with the corner button", async () => {
  const user = userEvent.setup();
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="image"
      projectId="project-1"
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "生成模型" });
  const referencePicker = screen
    .getByRole("group", { name: "参考图片（可选）" })
    .querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(
    referencePicker,
    new File(["image"], "local.png", { type: "image/png" }),
  );

  const referenceCard = await screen.findByRole("button", {
    name: "参考图.png",
  });
  await user.click(referenceCard);
  const preview = screen.getByRole("dialog", { name: "参考图.png" });
  expect(within(preview).getByText("图片预览")).toBeInTheDocument();
  expect(referenceCard).toHaveAttribute("aria-pressed", "true");

  await user.click(within(preview).getByRole("button", { name: "关闭预览" }));
  expect(screen.queryByRole("dialog", { name: "参考图.png" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "移除参考文件 参考图.png" }),
  );
  expect(screen.queryByRole("button", { name: "参考图.png" })).toBeNull();
});

test("selects current, cross-project, and library media from the source menu", async () => {
  const user = userEvent.setup();
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="image"
      projectId="project-1"
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "生成模型" });
  const sourceTrigger = await screen.findByRole("button", {
    name: "上传参考图片（可选）",
  });

  await user.click(sourceTrigger);
  const sourceMenu = screen.getByRole("menu", {
    name: "参考图片（可选）来源",
  });
  expect(
    within(sourceMenu).getByRole("menuitem", { name: /本地上传/ }),
  ).toBeVisible();
  await user.click(
    within(sourceMenu).getByRole("menuitem", { name: /本项目素材/ }),
  );
  const projectDialog = await screen.findByRole("dialog", {
    name: "选择本项目素材",
  });
  await user.click(
    await within(projectDialog).findByRole("option", { name: "参考图.png" }),
  );
  await user.click(
    within(projectDialog).getByRole("button", { name: "确认选择" }),
  );
  expect(
    await screen.findByRole("button", { name: "参考图.png" }),
  ).toBeVisible();

  await user.click(sourceTrigger);
  await user.click(screen.getByRole("menuitem", { name: /跨项目素材/ }));
  const crossDialog = await screen.findByRole("dialog", {
    name: "选择跨项目素材",
  });
  expect(within(crossDialog).getByLabelText("来源项目")).toHaveTextContent(
    "其他视觉项目",
  );
  await user.click(
    await within(crossDialog).findByRole("option", {
      name: "跨项目参考图.png",
    }),
  );
  await user.click(
    within(crossDialog).getByRole("button", { name: "导入并选择" }),
  );
  await waitFor(() =>
    expect(importManagedFiles).toHaveBeenCalledWith("project-1", {
      sourceScope: "project",
      sourceProjectId: "project-2",
      assetIds: ["cross-project-asset"],
    }),
  );
  expect(
    await screen.findByRole("button", { name: "跨项目参考图.png" }),
  ).toBeVisible();

  await user.click(sourceTrigger);
  await user.click(screen.getByRole("menuitem", { name: /跨项目素材/ }));
  const libraryDialog = await screen.findByRole("dialog", {
    name: "选择跨项目素材",
  });
  await user.click(within(libraryDialog).getByRole("tab", { name: "公共库" }));
  await user.click(
    await within(libraryDialog).findByRole("option", {
      name: "公共参考图.png",
    }),
  );
  await user.click(
    within(libraryDialog).getByRole("button", { name: "导入并选择" }),
  );
  await waitFor(() =>
    expect(importManagedFiles).toHaveBeenCalledWith("project-1", {
      sourceScope: "library",
      assetIds: ["library-asset"],
    }),
  );
  expect(
    await screen.findByRole("button", { name: "公共参考图.png" }),
  ).toBeVisible();
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
  expect(durationSlider).toHaveAttribute("min", "2");
  expect(durationSlider).toHaveAttribute("max", "15");
  fireEvent.change(durationSlider, { target: { value: "8" } });
  await user.click(screen.getByRole("combobox", { name: "清晰度" }));
  await user.click(screen.getByRole("option", { name: "1080P" }));
  await user.click(screen.getByRole("combobox", { name: "画面比例" }));
  await user.click(screen.getByRole("option", { name: "9:16" }));
  expect(screen.getByText("9:16 · 8S · 1080P")).toBeInTheDocument();
  expect(
    screen.getByRole("navigation", { name: "视频生成方式" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "图生视频" }));
  const startFramePicker = screen
    .getByRole("group", { name: "起始画面" })
    .querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(
    startFramePicker,
    new File(["image"], "local.png", { type: "image/png" }),
  );
  const promptEditor = screen.getByRole("textbox", { name: "视频提示词" });
  expect(promptEditor).toHaveAttribute("contenteditable", "true");
  await user.type(promptEditor, "@");
  const mentionMenu = await screen.findByRole("listbox", {
    name: "引用已选素材",
  });
  expect(
    within(mentionMenu).getByRole("option", { name: /参考图\.png/ }),
  ).toBeInTheDocument();
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("button", { name: "移除引用 参考图.png" }),
  ).toBeInTheDocument();
  await user.type(promptEditor, " 镜头缓慢推进");
  expect(promptEditor).toHaveTextContent("参考图.png 镜头缓慢推进");
  await user.click(screen.getByRole("button", { name: "生成视频" }));

  await waitFor(() =>
    expect(createGenerationTask).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        kind: "video",
        mode: "frames",
        first_frame_asset_id: "asset-1",
        last_frame_asset_id: null,
        prompt: "[参考图.png] 镜头缓慢推进",
      }),
    ),
  );
});

test("restores a node video draft, saves edits, and keeps it after submission", async () => {
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
  const onDraftChange = vi.fn();
  const onBeforeSubmit = vi.fn().mockResolvedValue(undefined);
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="video"
      projectId="project-1"
      draft={{
        model_id: "model-video",
        prompt: "已保存的推进镜头",
        mode: "image",
        duration: 8,
        resolution: "1080p",
        ratio: "9:16",
        watermark: false,
        generate_audio: true,
        first_frame_asset_id: "asset-1",
        last_frame_asset_id: null,
        reference_asset_ids: [],
        audio_asset_ids: [],
        video_asset_ids: [],
      }}
      onClose={vi.fn()}
      onDraftChange={onDraftChange}
      onBeforeSubmit={onBeforeSubmit}
    />,
  );

  expect(
    await screen.findByRole("button", { name: "图生视频" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("textbox", { name: "视频提示词" })).toHaveTextContent(
    "已保存的推进镜头",
  );
  expect(screen.getByText("9:16 · 8S · 1080P")).toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: "参考图.png" }),
  ).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByText("9:16 · 8S · 1080P"));
  await user.click(screen.getByRole("checkbox", { name: "保留水印" }));
  expect(onDraftChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      prompt: "已保存的推进镜头",
      mode: "image",
      first_frame_asset_id: "asset-1",
      watermark: true,
    }),
    true,
  );

  await user.click(screen.getByRole("button", { name: "生成视频" }));
  await waitFor(() => expect(createGenerationTask).toHaveBeenCalled());
  expect(onBeforeSubmit).toHaveBeenCalledTimes(1);
  expect(onBeforeSubmit.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(createGenerationTask).mock.invocationCallOrder.at(-1)!,
  );
  expect(screen.getByRole("textbox", { name: "视频提示词" })).toHaveTextContent(
    "已保存的推进镜头",
  );
  expect(
    screen.getByRole("button", { name: "参考图.png" }),
  ).toBeInTheDocument();
});

test("retains incompatible video references with per-item disabled styling", async () => {
  const user = userEvent.setup();
  const onDraftChange = vi.fn();
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="video"
      projectId="project-1"
      draft={{
        model_id: "model-video",
        prompt: "保留参考素材",
        mode: "reference",
        duration: 5,
        resolution: "720p",
        ratio: "16:9",
        watermark: true,
        generate_audio: false,
        first_frame_asset_id: null,
        last_frame_asset_id: null,
        reference_asset_ids: ["asset-1"],
        video_asset_ids: ["asset-video"],
        audio_asset_ids: ["asset-audio"],
      }}
      onClose={vi.fn()}
      onDraftChange={onDraftChange}
    />,
  );

  expect(
    await screen.findByRole("button", { name: "参考视频.mp4" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "文生视频" }));

  expect(screen.getByRole("group", { name: "参考图片" })).toBeDisabled();
  expect(screen.getByRole("group", { name: "参考视频" })).toBeDisabled();
  expect(screen.getByRole("group", { name: "参考音频" })).toBeDisabled();
  expect(
    document.querySelectorAll(
      ".generation-image-picker.is-disabled .generation-media-card",
    ),
  ).toHaveLength(3);
  const promptEditor = screen.getByRole("textbox", { name: "视频提示词" });
  await user.click(promptEditor);
  await user.type(promptEditor, "@");
  expect(
    screen.queryByRole("listbox", { name: "引用已选素材" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "全能参考" }));
  expect(
    screen.getByRole("button", { name: "参考视频.mp4" }),
  ).toBeInTheDocument();
});

test("retains music references while sound-effect mode disables them", async () => {
  vi.mocked(getGenerationOptions).mockResolvedValueOnce({
    models: [
      {
        id: "model-music",
        provider_id: "provider-audio",
        provider_name: "SenseAudio 音频生成",
        kind: "audio",
        slug: "music-generation",
        label: "Music Generation",
        description: "音乐生成",
        sizes: [],
      },
      {
        id: "model-sfx",
        provider_id: "provider-audio",
        provider_name: "SenseAudio 音频生成",
        kind: "audio",
        slug: "sfx-generation",
        label: "SFX Generation",
        description: "音效生成",
        sizes: [],
      },
    ],
  });
  const user = userEvent.setup();
  const onDraftChange = vi.fn();
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="audio"
      projectId="project-1"
      draft={{
        model_id: "model-music",
        mode: "music",
        prompt: "安静的钢琴",
        theme: "夜晚",
        style: "氛围",
        duration: 15,
        smart_duration: true,
        prompt_influence: 0.5,
        output_format: "mp3",
        reference_asset_ids: ["asset-audio"],
      }}
      onClose={vi.fn()}
      onDraftChange={onDraftChange}
    />,
  );

  expect(
    await screen.findByRole("button", { name: "参考音频.mp3" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "音效生成" }));

  expect(screen.getByRole("group", { name: "参考音频" })).toBeDisabled();
  expect(onDraftChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      mode: "sfx",
      reference_asset_ids: ["asset-audio"],
    }),
    true,
  );

  await user.click(screen.getByRole("button", { name: "音乐生成" }));
  expect(screen.getByRole("group", { name: "参考音频" })).not.toBeDisabled();
  expect(
    screen.getByRole("button", { name: "参考音频.mp3" }),
  ).toBeInTheDocument();
});

test("removes a missing saved asset from the node draft after loading files", async () => {
  const onDraftChange = vi.fn();
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="video"
      projectId="project-1"
      draft={{
        model_id: "model-video",
        prompt: "失效素材草稿",
        mode: "image",
        duration: 5,
        resolution: "720p",
        ratio: "16:9",
        watermark: true,
        generate_audio: false,
        first_frame_asset_id: "missing-image",
        last_frame_asset_id: null,
        reference_asset_ids: [],
        audio_asset_ids: [],
        video_asset_ids: [],
      }}
      onClose={vi.fn()}
      onDraftChange={onDraftChange}
    />,
  );

  expect(
    await screen.findByText("部分已选择素材已失效，已从当前草稿移除。"),
  ).toBeInTheDocument();
  expect(onDraftChange).toHaveBeenCalledWith(
    expect.objectContaining({ first_frame_asset_id: null }),
    true,
  );
});

test("keeps the prompt editor mounted after deleting a text selection", async () => {
  const user = userEvent.setup();
  renderWithClient(
    <GenerationDrawer
      compact
      lockedKind="video"
      projectId="project-1"
      onClose={vi.fn()}
    />,
  );

  const editor = await screen.findByRole("textbox", { name: "视频提示词" });
  await user.type(editor, "第一版提示词");
  const range = document.createRange();
  range.selectNodeContents(editor);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  expect(fireEvent.keyDown(editor, { key: "Backspace" })).toBe(false);
  await user.type(editor, "第二版提示词", { skipClick: true });
  expect(editor).toHaveTextContent("第二版提示词");
  expect(editor).not.toHaveTextContent("第一版提示词");

  range.selectNodeContents(editor);
  selection?.removeAllRanges();
  selection?.addRange(range);
  await user.type(editor, "直接替换提示词", { skipClick: true });
  expect(editor).toHaveTextContent("直接替换提示词");
  expect(editor).not.toHaveTextContent("第二版提示词");
});

test("shows the official video modes and conditional reference fields", async () => {
  const user = userEvent.setup();
  renderWithClient(
    <GenerationDrawer projectId="project-1" onClose={vi.fn()} />,
  );
  await user.click(await screen.findByRole("tab", { name: "视频" }));
  expect(screen.getByRole("combobox", { name: "生成模型" })).toHaveTextContent(
    "Doubao Seedance 2.0",
  );
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
  const modelMenu = await screen.findByRole("button", {
    name: "生成模型",
  });
  await waitFor(() =>
    expect(modelMenu).toHaveTextContent("Doubao Seedance 2.0"),
  );
  await user.click(modelMenu);
  expect(
    screen.getByRole("option", { name: "Doubao Seedance 2.0" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "全能参考" }));
  const stickyReferenceBar = screen.getByRole("group", {
    name: "固定参考素材",
  });
  expect(stickyReferenceBar).toHaveClass("video-composer-reference");
  expect(screen.queryByText(/已选 0\//)).not.toBeInTheDocument();
  expect(
    within(stickyReferenceBar).getByRole("button", { name: "上传参考图片" }),
  ).toBeInTheDocument();
  expect(
    within(stickyReferenceBar).getByRole("button", { name: "上传参考视频" }),
  ).toBeInTheDocument();
  expect(
    within(stickyReferenceBar).getByRole("button", { name: "上传参考音频" }),
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
  await user.click(await screen.findByRole("button", { name: "参考视频.mp4" }));
  const videoPreview = screen.getByRole("dialog", { name: "参考视频.mp4" });
  expect(within(videoPreview).getByText("视频预览")).toBeInTheDocument();
  await user.click(
    within(videoPreview).getByRole("button", { name: "关闭预览" }),
  );
  await user.click(screen.getByRole("button", { name: "参考音频.mp3" }));
  const audioPreview = screen.getByRole("dialog", { name: "参考音频.mp3" });
  expect(within(audioPreview).getByText("音频预览")).toBeInTheDocument();
  await user.click(
    within(audioPreview).getByRole("button", { name: "关闭预览" }),
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
