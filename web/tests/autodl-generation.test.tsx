import { VideoSeedControl } from "@features/models/generation/VideoSeedControl";
import { useVideoDefaults } from "@features/visual-workshop/generation/useVideoDefaults";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenerationDrawer } from "@features/visual-workshop/generation/GenerationDrawer";
import { ModelGenerationTestPanel } from "@features/models/generation/ModelGenerationTestPanel";
import {
  videoChoices,
  videoRequestParameters,
  videoSelectionError,
  type VideoCapabilities,
} from "@features/models/generation/videoCapabilities";
import {
  createGenerationTask,
  getGenerationOptions,
} from "@features/visual-workshop/api";
import {
  createModelTestGenerationTask,
  getModelTestGenerationOptions,
} from "@features/models/api";

vi.mock("@features/visual-workshop/api", async (original) => ({
  ...(await original<typeof import("@features/visual-workshop/api")>()),
  getGenerationOptions: vi.fn(),
  createGenerationTask: vi.fn().mockResolvedValue({ id: "task" }),
}));
vi.mock("@features/files/api", async (original) => ({
  ...(await original<typeof import("@features/files/api")>()),
  getFiles: vi.fn().mockResolvedValue({ items: [] }),
  getFolders: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("@features/models/api", async (original) => ({
  ...(await original<typeof import("@features/models/api")>()),
  getModelTestGenerationOptions: vi.fn(),
  getModelTestGenerationTasks: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0 }),
  getModelTestReferenceBackfillStatus: vi
    .fn()
    .mockResolvedValue({ pending_tasks: 0 }),
  cleanupModelTestReferenceAssets: vi.fn().mockResolvedValue({}),
  createModelTestGenerationTask: vi.fn().mockResolvedValue({ id: "test-task" }),
}));

const caps: VideoCapabilities = {
  duration_min: 1,
  duration_max: 15,
  supports_auto_duration: false,
  resolutions: ["480p", "768p", "960p"],
  ratios: ["9:16", "16:9"],
  reference_limits: { image: 9, audio: 3, video: 0 },
  reference_minimums: { image: 1, audio: 0, video: 0 },
  reference_mime_types: {
    image: ["image/png", "image/jpeg", "image/webp"],
    audio: ["audio/mpeg", "audio/wav"],
  },
  audio_only: false,
  frames_require_adaptive_ratio: false,
  default_generate_audio: false,
  reference_video_upload_configured: true,
  supported_modes: ["reference"],
  supports_prompt: true,
  prompt_required: true,
  max_prompt_length: 20000,
  supports_duration: true,
  duration_label: "时长",
  supports_ratio: true,
  supports_watermark: false,
  supports_generate_audio: false,
  supports_seed: false,
  seed_minimum: 0,
  seed_maximum: 999999999999999,
  default_resolution: "768p",
  default_ratio: "9:16",
  resolution_ratios: {
    "480p": ["9:16", "16:9"],
    "768p": ["9:16", "16:9"],
    "960p": ["9:16"],
  },
};
function option(capabilities = caps) {
  return {
    id: "autodl",
    provider_id: "provider",
    provider_name: "AutoDL",
    kind: "video" as const,
    slug: "minimax_h3_zm_nono",
    label: "AutoDL H3",
    description: "",
    sizes: [],
    max_prompt_length: 20000,
    max_reference_images: 9,
    supports_seed: false,
    video_capabilities: capabilities,
  };
}
function setup(capabilities = caps) {
  const model = option(capabilities);
  vi.mocked(getGenerationOptions).mockResolvedValue({ models: [model] });
  vi.mocked(getModelTestGenerationOptions).mockResolvedValue({
    items: [model],
  });
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
function panel(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ModelGenerationTestPanel
        modelId="autodl"
        models={[
          {
            value: "autodl",
            label: "AutoDL H3",
            description: "",
            providerKind: "autodl_video",
          },
        ]}
        onSelectModel={vi.fn()}
        onSelectMode={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.mocked(createGenerationTask).mockClear();
  vi.mocked(createModelTestGenerationTask).mockClear();
});

test("resolution combinations and required images are enforced without inventing 960p landscape", () => {
  expect(videoChoices(caps, false, "960p").ratios).toEqual(["9:16"]);
  const selection = {
    mode: "reference",
    prompt: "test",
    duration: 1,
    resolution: "768p",
    ratio: "9:16",
    image: 0,
    audio: 0,
    video: 0,
  };
  expect(videoSelectionError(caps, selection)).toMatch("至少需要 1");
  expect(videoSelectionError(caps, { ...selection, image: 1 })).toBe("");
  expect(
    videoSelectionError(caps, {
      ...selection,
      image: 1,
      resolution: "960p",
      ratio: "16:9",
    }),
  ).toMatch("比例");
  expect(
    videoSelectionError(
      { ...caps, supports_seed: true },
      { ...selection, image: 1, seed: "1000000000000000" },
    ),
  ).toMatch("种子");
});

test("AutoDL requests omit unsupported switches and snapshot only the supported seed", () => {
  const request = videoRequestParameters(
    { ...caps, supports_seed: true },
    {
      resolution: "768p",
      ratio: "9:16",
      watermark: true,
      generateAudio: true,
      seed: "0",
    },
  );
  expect(request).toEqual({
    resolution: "768p",
    ratio: "9:16",
    workflow_parameters: { seed: 0 },
  });
  expect(
    videoRequestParameters(
      { ...caps, supports_ratio: false },
      {
        resolution: "464x832",
        ratio: "16:9",
        watermark: true,
        generateAudio: true,
      },
    ),
  ).toEqual({ resolution: "464x832" });
});

test("model test uses workflow defaults, 20k prompts and hides unsupported switches", async () => {
  panel(setup());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "768p" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
  expect(screen.getByRole("textbox", { name: /提示词/ })).toHaveAttribute(
    "maxlength",
    "20000",
  );
  expect(screen.queryByText("生成音频")).not.toBeInTheDocument();
  expect(screen.queryByText("保留水印")).not.toBeInTheDocument();
  const input = screen.getByLabelText("视频输入方式");
  await userEvent.click(input);
  expect(
    screen.queryByRole("option", { name: "纯文本" }),
  ).not.toBeInTheDocument();
});

test("text generation submits canonical defaults through the model test API", async () => {
  panel(
    setup({
      ...caps,
      supported_modes: ["text"],
      reference_limits: { image: 0, audio: 0, video: 0 },
      reference_minimums: {},
      supports_seed: true,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "768p" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
  fireEvent.change(screen.getByRole("textbox", { name: /提示词/ }), {
    target: { value: "camera moves" },
  });
  await userEvent.click(screen.getByRole("button", { name: "开始测试" }));
  await waitFor(() =>
    expect(createModelTestGenerationTask).toHaveBeenCalledOnce(),
  );
  expect(
    vi.mocked(createModelTestGenerationTask).mock.calls[0][0],
  ).toMatchObject({
    mode: "text",
    prompt: "camera moves",
    resolution: "768p",
    ratio: "9:16",
    duration: 5,
    workflow_parameters: { seed: null },
  });
  expect(
    vi.mocked(createModelTestGenerationTask).mock.calls[0][0],
  ).not.toHaveProperty("generate_audio");
});

test.each(["时长", "音频截取时长"])(
  "workshop slider preserves workflow limits and saves %s",
  async (label) => {
    const client = setup({ ...caps, duration_label: label });
    const save = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <GenerationDrawer
          projectId="project"
          lockedKind="video"
          compact
          onClose={vi.fn()}
          onDraftChange={save}
        />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("生成模型")).toHaveTextContent("AutoDL H3"),
    );
    await userEvent.click(screen.getByRole("button", { name: "视频参数" }));
    const slider = screen.getByRole("slider", { name: label });
    expect(slider).toHaveAttribute("min", "1");
    expect(slider).toHaveAttribute("max", "15");
    fireEvent.change(slider, { target: { value: "15" } });
    fireEvent.pointerUp(slider);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ duration: 15 }),
      true,
    );
    expect(
      screen.queryByRole("button", { name: "自动时长" }),
    ).not.toBeInTheDocument();
  },
);

test("motion transfer composer hides prompt and duration but exposes exact pixel sizes", async () => {
  const client = setup({
    ...caps,
    supports_prompt: false,
    supports_duration: false,
    supports_ratio: false,
    supports_seed: true,
    resolutions: ["464x832", "832x464"],
    default_resolution: "464x832",
    ratios: [],
    reference_limits: { image: 1, audio: 0, video: 1 },
    reference_minimums: { image: 1, video: 1 },
  });
  render(
    <QueryClientProvider client={client}>
      <GenerationDrawer
        projectId="project"
        lockedKind="video"
        compact
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("生成模型")).toHaveTextContent("AutoDL H3"),
  );
  expect(
    screen.queryByRole("textbox", { name: "视频提示词" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("视频参数"));
  expect(screen.getByText("时长随输入视频")).toBeInTheDocument();
  expect(screen.queryByLabelText("时长")).not.toBeInTheDocument();
  expect(screen.queryByText("画面比例")).not.toBeInTheDocument();
  expect(screen.getByLabelText("随机种子")).toBeInTheDocument();
});

test("audio synchronization labels its duration and does not require a prompt", async () => {
  panel(
    setup({
      ...caps,
      supports_prompt: false,
      duration_label: "音频截取时长",
      reference_limits: { image: 1, audio: 1, video: 0 },
      reference_minimums: { image: 1, audio: 1 },
    }),
  );
  await waitFor(() =>
    expect(screen.getByText("音频截取时长")).toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("textbox", { name: /提示词/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "开始测试" })).toBeEnabled();
});

test("restores AutoDL defaults when the initial saved draft still has legacy 720p", () => {
  const resolution = vi.fn(),
    ratio = vi.fn(),
    mode = vi.fn(),
    audio = vi.fn();
  const draft = {
    model_id: "autodl",
    resolution: "720p" as const,
    ratio: "16:9" as const,
    mode: "text" as const,
    prompt: "",
    duration: 5,
    watermark: true,
    generate_audio: false,
    reference_asset_ids: [],
    audio_asset_ids: [],
    video_asset_ids: [],
    prompt_reference_names: {},
    prompt_versions: [{ id: "v1", name: "v1", prompt: "" }],
    active_prompt_version_id: "v1",
  };
  const { rerender } = renderHook(
    ({ resolution: saved }: { resolution: "720p" | "480p" }) =>
      useVideoDefaults(
        caps,
        { ...draft, resolution: saved },
        resolution,
        ratio,
        mode,
        audio,
      ),
    { initialProps: { resolution: "720p" } },
  );
  expect(resolution).toHaveBeenCalledWith("768p");
  expect(ratio).toHaveBeenCalledWith("9:16");
  expect(mode).toHaveBeenCalledWith("reference");
  resolution.mockClear();
  rerender({ resolution: "480p" });
  expect(resolution).not.toHaveBeenCalled();
});

test("canvas frame workflow submits linked image order with the current canvas revision", async () => {
  const client = setup({
    ...caps,
    supported_modes: ["frames"],
    reference_limits: { image: 2, audio: 0, video: 0 },
    reference_minimums: { image: 2 },
    supports_seed: true,
  });
  render(
    <QueryClientProvider client={client}>
      <GenerationDrawer
        projectId="project"
        lockedKind="video"
        compact
        canvasNodeId="target"
        linkedAssetIds={{ image: ["first", "last"], video: [], audio: [] }}
        onBeforeSubmit={async () => 3}
        onClose={vi.fn()}
        draft={{
          model_id: "autodl",
          mode: "frames",
          prompt: "camera moves",
          duration: 5,
          resolution: "768p",
          ratio: "9:16",
          watermark: true,
          generate_audio: false,
          reference_asset_ids: [],
          audio_asset_ids: [],
          video_asset_ids: [],
          prompt_reference_names: {},
        }}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("生成模型")).toHaveTextContent("AutoDL H3"),
  );
  await userEvent.click(screen.getByRole("button", { name: "生成视频" }));
  await waitFor(() => expect(createGenerationTask).toHaveBeenCalledOnce());
  expect(vi.mocked(createGenerationTask).mock.calls[0][1]).toMatchObject({
    mode: "frames",
    first_frame_asset_id: "first",
    last_frame_asset_id: "last",
    canvas_node_id: "target",
    expected_canvas_revision: 3,
    reference_asset_ids: [],
  });
});

test("invalid seeds remain editable and never persist an invalid canvas draft", () => {
  const commit = vi.fn(),
    change = vi.fn();
  render(
    <VideoSeedControl
      capabilities={{ ...caps, supports_seed: true }}
      value=""
      onChange={change}
      onCommit={commit}
    />,
  );
  const input = screen.getByLabelText("随机种子");
  fireEvent.change(input, { target: { value: "-1" } });
  expect(change).toHaveBeenLastCalledWith("-1");
  expect(commit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "1.5" } });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "0" } });
  expect(commit).toHaveBeenLastCalledWith(0);
});
