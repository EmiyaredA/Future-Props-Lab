import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenerationDrawer } from "@features/visual-workshop/generation/GenerationDrawer";
import {
  createGenerationTask,
  getGenerationOptions,
} from "@features/visual-workshop/api";

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

beforeEach(() => {
  vi.mocked(createGenerationTask).mockClear();
  vi.mocked(getGenerationOptions).mockResolvedValue({
    models: ["u06", "u17"].map(
      (
        id,
      ): Awaited<
        ReturnType<typeof getGenerationOptions>
      >["models"][number] => ({
        id,
        kind: "video",
        provider_id: "p",
        provider_name: "ZEALMAN",
        slug: id,
        label: id.toUpperCase(),
        description: "",
        sizes: [],
        max_reference_images: 9,
        max_prompt_length: 6000,
        supports_seed: true,
        workflow_capabilities: {
          reference_limits: { image: 9, video: id === "u17" ? 1 : 0, audio: 3 },
          supports_ratio: id === "u17",
          joint_audio: true,
          parameters:
            id === "u06"
              ? {
                  width: {
                    default: 1344,
                    minimum: 256,
                    maximum: 2048,
                    step: 32,
                  },
                  height: {
                    default: 768,
                    minimum: 256,
                    maximum: 2048,
                    step: 32,
                  },
                  seed: {
                    default: null,
                    minimum: 0,
                    maximum: 1125899906842624,
                    step: 1,
                  },
                }
              : {
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
                },
        },
      }),
    ),
  });
});

function mount(compact = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const save = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <GenerationDrawer
        compact={compact}
        lockedKind="video"
        layout="workbench"
        projectId="p"
        onClose={vi.fn()}
        onDraftChange={save}
        draft={{
          model_id: "u06",
          prompt: "generate my scene",
          mode: "text",
          duration: 5,
          ratio: "16:9",
          resolution: "720p",
          watermark: true,
          generate_audio: false,
        }}
      />
    </QueryClientProvider>,
  );
  return save;
}

test("workbench model selector supports keyboard selection and exposes workflow-specific parameters", async () => {
  const user = userEvent.setup();
  mount();
  const select = await screen.findByRole("combobox", { name: "生成模型" });
  await waitFor(() => expect(select).toHaveTextContent("U06"));
  await user.click(screen.getByRole("button", { name: "视频参数" }));
  expect(screen.getByRole("spinbutton", { name: "宽度" })).toHaveValue(1344);
  expect(screen.queryByText("保留水印")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "画面比例" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "时长" })).toHaveAttribute(
    "min",
    "4",
  );
  await user.click(screen.getByRole("button", { name: "全能参考" }));
  expect(
    screen.queryByRole("group", { name: "参考视频" }),
  ).not.toBeInTheDocument();
  await user.click(select);
  expect(screen.getByRole("listbox", { name: "生成模型" })).toHaveAttribute(
    "popover",
    "manual",
  );
  await user.keyboard("{End}{Enter}");
  expect(select).toHaveTextContent("U17");
  expect(select).toHaveFocus();
  expect(screen.getByRole("spinbutton", { name: "百万像素" })).toHaveValue(0.9);
  expect(screen.getByRole("group", { name: "参考视频" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "首尾帧" }),
  ).not.toBeInTheDocument();
});

test.each([true, false])(
  "workflow generation saves parameters and omits unsupported flags (compact=%s)",
  async (compact) => {
    const user = userEvent.setup();
    const save = mount(compact);
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "生成模型" }),
      ).toHaveTextContent("U06"),
    );
    if (compact)
      await user.click(screen.getByRole("button", { name: "视频参数" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "宽度" }), {
      target: { value: "640" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "种子（可选）" }), {
      target: { value: "42" },
    });
    expect(save.mock.lastCall?.[0].workflow_parameters).toEqual({
      width: 640,
      seed: 42,
    });
    await user.click(
      screen.getByRole("button", {
        name: compact ? "生成视频" : "创建生成任务",
      }),
    );
    await waitFor(() => expect(createGenerationTask).toHaveBeenCalledOnce());
    const body = vi.mocked(createGenerationTask).mock.calls[0][1];
    expect(body).toMatchObject({
      model_id: "u06",
      prompt: "generate my scene",
      workflow_parameters: { width: 640, seed: 42 },
    });
    expect(body).not.toHaveProperty("resolution");
    expect(body).not.toHaveProperty("ratio");
    expect(body).not.toHaveProperty("watermark");
    expect(body).not.toHaveProperty("generate_audio");
  },
);
