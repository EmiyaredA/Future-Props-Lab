import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenerationDrawer } from "@features/visual-workshop/generation/GenerationDrawer";
import { ModelGenerationTestPanel } from "@features/models/generation/ModelGenerationTestPanel";
import {
  videoChoices,
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
  duration_min: 4,
  duration_max: 30,
  supports_auto_duration: true,
  resolutions: ["480p", "720p", "1080p"],
  ratios: ["16:9", "9:16", "21:9", "adaptive"],
  reference_limits: { image: 30, video: 10, audio: 10 },
  audio_only: true,
  frames_require_adaptive_ratio: true,
  default_generate_audio: true,
  reference_video_upload_configured: false,
};
const option = {
  id: "ark25",
  provider_id: "ark",
  provider_name: "火山方舟视频",
  kind: "video" as const,
  slug: "doubao-seedance-2-5-260628",
  label: "Seedance 2.5",
  description: "",
  sizes: [],
  max_prompt_length: 2000,
  max_reference_images: 30,
  supports_seed: false,
  video_capabilities: caps,
};

beforeEach(() => {
  vi.mocked(createGenerationTask).mockClear();
  vi.mocked(createModelTestGenerationTask).mockClear();
  vi.mocked(getGenerationOptions).mockResolvedValue({ models: [option] });
  vi.mocked(getModelTestGenerationOptions).mockResolvedValue({
    items: [option],
  });
});

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

test("capabilities expose 30s and automatic duration; legacy options retain their limits", () => {
  expect(videoChoices(caps).durations.at(-1)?.value).toBe("30");
  expect(videoChoices(caps).durations[0].value).toBe("-1");
  expect(videoChoices(caps, true).ratios).toEqual(["adaptive"]);
  expect(videoChoices().durations.at(-1)?.value).toBe("15");
  const values = {
    duration: 30,
    resolution: "720p",
    ratio: "16:9",
    image: 30,
    video: 0,
    audio: 10,
  };
  expect(videoSelectionError(caps, values)).toBe("");
  expect(videoSelectionError(null, values)).toContain("时长");
  expect(videoSelectionError(caps, { ...values, video: 1 })).toContain(
    "temp_media_upload_url",
  );
  expect(videoSelectionError(caps, { ...values, image: 31 })).toContain("30");
  expect(videoSelectionError(caps, { ...values, image: 0 })).toBe("");
});

test.each([false, true])(
  "workshop restores a 30-second draft and sends version defaults (compact=%s)",
  async (compact) => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client()}>
        <GenerationDrawer
          projectId="project"
          lockedKind="video"
          compact={compact}
          onClose={vi.fn()}
          draft={{
            model_id: "ark25",
            mode: "text",
            prompt: "保存的提示词",
            duration: 30,
            resolution: "720p",
            ratio: "21:9",
            watermark: true,
            generate_audio: true,
            reference_asset_ids: [],
            audio_asset_ids: [],
            video_asset_ids: [],
            prompt_reference_names: {},
          }}
        />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "生成模型" }),
      ).toHaveTextContent("Seedance 2.5"),
    );
    if (compact)
      await user.click(screen.getByRole("button", { name: "视频参数" }));
    expect(
      screen.getByRole("combobox", { name: compact ? "时长" : "视频时长" }),
    ).toHaveTextContent("30 秒");
    await user.click(
      screen.getByRole("button", {
        name: compact ? "生成视频" : "创建生成任务",
      }),
    );
    await waitFor(() => expect(createGenerationTask).toHaveBeenCalledOnce());
    expect(vi.mocked(createGenerationTask).mock.calls[0][1]).toMatchObject({
      duration: 30,
      ratio: "21:9",
      generate_audio: true,
      model_id: "ark25",
    });
  },
);

test("test panel keeps prompt on model switch and submits a 30-second official task", async () => {
  const models = ["ark25", "ark20"].map((value) => ({
    value,
    label: value,
    providerKind: "volcengine_video",
    description: "",
    capabilities: ["video_generation"],
  }));
  const queryClient = client();
  const show = (modelId: string) => (
    <QueryClientProvider client={queryClient}>
      <ModelGenerationTestPanel
        models={models}
        modelId={modelId}
        onSelectModel={vi.fn()}
        onSelectMode={vi.fn()}
      />
    </QueryClientProvider>
  );
  const view = render(show("ark25"));
  await screen.findByText(/支持纯音频参考/);
  fireEvent.change(screen.getByPlaceholderText("描述镜头、动作和氛围…"), {
    target: { value: "保留这段提示词" },
  });
  view.rerender(show("ark20"));
  expect(screen.getByPlaceholderText("描述镜头、动作和氛围…")).toHaveValue(
    "保留这段提示词",
  );
  view.rerender(show("ark25"));
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "时长" }));
  await user.click(screen.getByRole("option", { name: "30 秒" }));
  await user.click(screen.getByRole("button", { name: "开始测试" }));
  await waitFor(() =>
    expect(createModelTestGenerationTask).toHaveBeenCalledOnce(),
  );
  expect(
    vi.mocked(createModelTestGenerationTask).mock.calls[0][0],
  ).toMatchObject({
    duration: 30,
    generate_audio: true,
    prompt: "保留这段提示词",
  });
});

test("switching to Seedance 2.5 frames persists the effective adaptive ratio", async () => {
  const save = vi.fn();
  render(
    <QueryClientProvider client={client()}>
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
    expect(
      screen.getByRole("combobox", { name: "生成模型" }),
    ).toHaveTextContent("Seedance 2.5"),
  );
  await userEvent.click(screen.getByRole("button", { name: "首尾帧" }));
  expect(save.mock.lastCall?.[0]).toMatchObject({
    mode: "frames",
    ratio: "adaptive",
  });
});
