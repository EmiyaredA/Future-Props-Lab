import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModelTestCapabilityPanel } from "@features/models/conversation/ModelTestCapabilityPanel";
import { preferredModeModel } from "@features/models/conversation/catalogTestSelection";
import { modelGenerationKind } from "@features/models/generation/modelGenerationOptions";
import {
  createModelTestGenerationTask,
  getModelTestGenerationOptions,
  type ModelTestGenerationOption,
} from "@features/models/api";

vi.mock("@features/models/api", () => ({
  getModelTestGenerationOptions: vi.fn(),
  getModelTestGenerationTasks: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0 }),
  getModelTestReferenceBackfillStatus: vi
    .fn()
    .mockResolvedValue({ pending_tasks: 0 }),
  cleanupModelTestReferenceAssets: vi.fn().mockResolvedValue({}),
  createModelTestGenerationTask: vi.fn().mockResolvedValue({ id: "task" }),
  deleteModelTestReferenceAsset: vi.fn(),
  deleteModelTestGenerationTask: vi.fn(),
  getModelTestGenerationResult: vi.fn(),
  retryModelTestGenerationMaterialization: vi.fn(),
  backfillModelTestReferenceAssets: vi.fn(),
  uploadModelTestReferenceAssets: vi.fn(),
}));

const models: Parameters<typeof preferredModeModel>[0] = ["u06", "u17"].map(
  (value) => ({
    value,
    label: value,
    description: "",
    providerKind: "zealman_video",
    capabilities: ["video_generation"],
  }),
);

beforeEach(() => {
  vi.mocked(createModelTestGenerationTask).mockClear();
  vi.mocked(getModelTestGenerationOptions).mockResolvedValue({
    items: models.map((model): ModelTestGenerationOption => ({
      id: model.value,
      provider_id: "p",
      provider_name: "ZEALMAN",
      kind: "video",
      slug: model.value,
      label: model.label,
      description: "",
      sizes: [],
      workflow_capabilities: {
        reference_limits: {
          image: 9,
          audio: 3,
          video: model.value === "u17" ? 1 : 0,
        },
        joint_audio: true,
        supports_ratio: model.value === "u17",
        parameters:
          model.value === "u17"
            ? {
                megapixels: {
                  default: 0.9,
                  minimum: 0.1,
                  maximum: 2,
                  step: 0.1,
                },
                upscale_factor: {
                  default: 1.5,
                  minimum: 1,
                  maximum: 2,
                  step: 0.1,
                },
              }
            : {
                width: { default: 1344, minimum: 256, maximum: 2048, step: 32 },
                height: { default: 768, minimum: 256, maximum: 2048, step: 32 },
                seed: {
                  default: null,
                  minimum: 0,
                  maximum: 1125899906842624,
                  step: 1,
                },
              },
      },
    })),
  });
});

function show(modelId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ModelTestCapabilityPanel
        models={models}
        modelId={modelId}
        onSelectModel={vi.fn()}
        onSelectMode={vi.fn()}
        onOpenAudioAnnotation={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

test("ZEALMAN participates in video mode and U06 sends only supported parameters", async () => {
  expect(modelGenerationKind(models[0])).toBe("video");
  expect(preferredModeModel(models, "video", "u06")?.value).toBe("u06");
  show("u06");
  expect(await screen.findByRole("spinbutton", { name: "宽度" })).toHaveValue(
    1344,
  );
  expect(screen.getByRole("spinbutton", { name: "高度" })).toHaveValue(768);
  expect(
    screen.queryByRole("group", { name: "分辨率" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "比例" })).not.toBeInTheDocument();
  expect(screen.queryByText("保留水印")).not.toBeInTheDocument();
  expect(screen.getByText(/最多 9 图、3 音频、0 视频/)).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("描述镜头、动作和氛围…"), {
    target: { value: "actual prompt" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "宽度" }), {
    target: { value: "640" },
  });
  fireEvent.click(screen.getByRole("button", { name: "开始测试" }));
  await waitFor(() => expect(createModelTestGenerationTask).toHaveBeenCalled());
  const body = vi.mocked(createModelTestGenerationTask).mock.calls[0][0];
  expect(body).toMatchObject({
    kind: "video",
    model_id: "u06",
    prompt: "actual prompt",
    workflow_parameters: { width: 640, height: 768, seed: null },
  });
  expect(body).not.toHaveProperty("ratio");
  expect(body).not.toHaveProperty("resolution");
  expect(body).not.toHaveProperty("generate_audio");
});

test("U17 exposes megapixels, upscale and aspect ratio without legacy switches", async () => {
  show("u17");
  expect(
    await screen.findByRole("spinbutton", { name: "百万像素" }),
  ).toHaveValue(0.9);
  expect(screen.getByRole("spinbutton", { name: "放大倍率" })).toHaveValue(1.5);
  expect(screen.getByRole("button", { name: "9:16" })).toBeInTheDocument();
  expect(
    screen.queryByRole("spinbutton", { name: "宽度" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("保留水印")).not.toBeInTheDocument();
  expect(screen.getByText(/最多 9 图、3 音频、1 视频/)).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("描述镜头、动作和氛围…"), {
    target: { value: "u17 prompt" },
  });
  fireEvent.click(screen.getByRole("button", { name: "9:16" }));
  fireEvent.click(screen.getByRole("button", { name: "开始测试" }));
  await waitFor(() => expect(createModelTestGenerationTask).toHaveBeenCalled());
  expect(
    vi.mocked(createModelTestGenerationTask).mock.calls[0][0],
  ).toMatchObject({
    ratio: "9:16",
    workflow_parameters: { megapixels: 0.9, upscale_factor: 1.5 },
  });
});
