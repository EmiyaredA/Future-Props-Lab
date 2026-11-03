import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SpeechSynthesisTestPanel } from "@features/models/generation/SpeechSynthesisTestPanel";
import * as speechApi from "@features/models/localModelApi";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";
import type { InferenceTask } from "@features/models/localModelApi";
import { modelQueryKeys } from "@features/models/queryKeys";

vi.mock("@features/models/localModelApi", () => ({
  getInferenceOptions: vi.fn(),
  getInferenceTasks: vi.fn(),
  uploadInferenceAudio: vi.fn(),
  importInferenceAudio: vi.fn(),
  deleteInferenceAudio: vi.fn(),
  createSpeechTask: vi.fn(),
  saveSpeechTask: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: (path: string | null) => ({
    url: path ? "blob:test-speech" : "",
    loading: false,
    error: null,
  }),
}));
vi.mock("@features/models/generation/ModelTranscriptionTaskViews", () => ({
  LibraryPicker: ({
    onSelect,
  }: {
    onSelect: (file: { id: string }) => void;
  }) => (
    <button onClick={() => onSelect({ id: "library-audio" })}>
      选择文件库录音
    </button>
  ),
}));
const models = [
  {
    value: "m",
    label: "Qwen3-TTS 0.6B Base",
    description: "",
    providerKind: "local_qwen_tts",
    capabilities: ["speech_synthesis"],
  },
];
const reference = {
  id: "ref",
  filename: "旁白参考.wav",
  byte_size: 2516582,
  media_kind: "audio",
  mime_type: "audio/wav",
};
function result(overrides: Partial<InferenceTask> = {}): InferenceTask {
  return {
    id: "task",
    model_id: "m",
    model_slug: "qwen3-tts-0.6b-base",
    kind: "speech_synthesis",
    status: "completed",
    progress: 100,
    request_payload: { text: "欢迎来到未来道具研究所。" },
    result: {},
    result_filename: "speech.wav",
    result_mime_type: "audio/wav",
    result_byte_size: 100,
    result_available: true,
    can_retry_materialization: false,
    error_message: null,
    log_id: "log",
    revision: 1,
    created_at: "2026-10-20T10:00:00Z",
    updated_at: "2026-10-20T10:00:00Z",
    ...overrides,
  };
}
let records: InferenceTask[];
const clients: QueryClient[] = [];
const selectModel = vi.fn();
function mount(permissions = ["models.use", "content.write"], accountId = "w") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const tree = (workspace: string) => (
    <QueryClientProvider client={client}>
      <AccountAccessProvider userId={workspace} permissions={permissions}>
        <SpeechSynthesisTestPanel
          models={models}
          modelId="m"
          onSelectModel={selectModel}
          onSelectMode={vi.fn()}
        />
      </AccountAccessProvider>
    </QueryClientProvider>
  );
  const view = render(tree(accountId));
  return {
    ...view,
    client,
    switchAccount: (next: string) => view.rerender(tree(next)),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  records = [];
  vi.mocked(speechApi.getInferenceOptions).mockResolvedValue({
    items: [
      {
        id: "m",
        label: models[0].label,
        modalities: ["speech_synthesis"],
        parameters: {
          speech_synthesis: {
            languages: ["Chinese", "English"],
            max_text_length: 2000,
            max_reference_bytes: 20 * 1024 ** 2,
            reference_extensions: [".wav", ".mp3"],
            min_reference_seconds: 3,
            max_reference_seconds: 30,
          },
        },
      },
    ],
  });
  vi.mocked(speechApi.getInferenceTasks).mockImplementation(async () => ({
    items: records,
    total: records.length,
  }));
  vi.mocked(speechApi.uploadInferenceAudio).mockResolvedValue(reference);
  vi.mocked(speechApi.importInferenceAudio).mockResolvedValue({
    ...reference,
    id: "library-ref",
  });
  vi.mocked(speechApi.createSpeechTask).mockImplementation(
    async (_id, text) => {
      const task = result({
        status: "running",
        result_available: false,
        request_payload: { text },
      });
      records = [task, ...records];
      return task;
    },
  );
  vi.mocked(speechApi.saveSpeechTask).mockResolvedValue({
    id: "asset",
    display_name: "speech.wav",
    original_filename: "speech.wav",
    media_kind: "audio",
    mime_type: "audio/wav",
    byte_size: 100,
    created_at: "2026-10-20T10:00:00Z",
    updated_at: "2026-10-20T10:00:00Z",
    folder_id: null,
    project_id: null,
    is_reference: false,
    revision: 1,
    source: "library",
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event("pause"));
  });
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
async function prepareDraft() {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText("参考录音")).toBeEnabled());
  await user.type(screen.getByLabelText("目标文字"), "这是需要生成的文稿");
  await user.type(
    screen.getByLabelText("录音对应文字"),
    "这是录音实际说的内容",
  );
  await user.upload(
    screen.getByLabelText("参考录音"),
    new File(["audio"], "voice.wav", { type: "audio/wav" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "生成语音" })).toBeEnabled(),
  );
  return user;
}

test("groups the required inputs, localizes language and expands the transcript without losing it", async () => {
  mount();
  await screen.findByText("中文");
  expect(screen.getByRole("heading", { name: "语音合成" })).toBeInTheDocument();
  expect(
    screen.getByRole("complementary", { name: "生成记录" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "生成语音" })).toBeDisabled();
  await userEvent.type(screen.getByLabelText("录音对应文字"), "保持对应文字");
  await userEvent.click(screen.getByRole("button", { name: "展开编辑" }));
  expect(screen.getByLabelText("录音对应文字")).toHaveAttribute("rows", "5");
  await userEvent.click(screen.getByRole("button", { name: "收起编辑" }));
  expect(screen.getByLabelText("录音对应文字")).toHaveValue("保持对应文字");
  await userEvent.click(screen.getByRole("combobox", { name: "合成语言" }));
  await userEvent.click(screen.getByRole("option", { name: "英语" }));
  expect(screen.getByRole("combobox", { name: "合成语言" })).toHaveTextContent(
    "英语",
  );
});

test("submitting adds the task to the result column and retains text while consuming the input", async () => {
  mount();
  const user = await prepareDraft();
  fireEvent.click(screen.getByText("参数与资源"));
  await user.click(screen.getByRole("button", { name: "生成语音" }));
  await waitFor(() =>
    expect(speechApi.createSpeechTask).toHaveBeenCalledWith(
      "m",
      "这是需要生成的文稿",
      "Chinese",
      reference,
      "这是录音实际说的内容",
    ),
  );
  expect(
    await within(
      screen.getByRole("article", { name: "选中的生成结果" }),
    ).findByText("正在生成"),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("目标文字")).toHaveValue("这是需要生成的文稿");
  expect(
    screen.getByRole("heading", { name: "模型测试" }).closest("section"),
  ).toHaveAttribute("data-compact-panel", "result");
  expect(screen.getByLabelText("录音对应文字")).toHaveValue(
    "这是录音实际说的内容",
  );
  expect(screen.getByRole("button", { name: "生成语音" })).toBeDisabled();
  expect(screen.getByText(/下次生成请重新选择参考录音/)).toBeInTheDocument();
});

test("failed submission preserves all inputs and does not replay the model request", async () => {
  vi.mocked(speechApi.createSpeechTask).mockRejectedValue(
    new Error("本机服务不可用"),
  );
  mount();
  const user = await prepareDraft();
  await user.click(screen.getByRole("button", { name: "生成语音" }));
  await screen.findByText("本机服务不可用");
  expect(screen.getByText(reference.filename)).toBeInTheDocument();
  expect(screen.getByLabelText("目标文字")).toHaveValue("这是需要生成的文稿");
  expect(screen.getByRole("button", { name: "生成语音" })).toBeEnabled();
  expect(speechApi.createSpeechTask).toHaveBeenCalledTimes(1);
});

test("successful submission is not presented as failed when history refresh fails", async () => {
  vi.mocked(speechApi.createSpeechTask).mockImplementation(async () => {
    vi.mocked(speechApi.getInferenceTasks).mockRejectedValue(
      new Error("刷新中断"),
    );
    return result({ status: "running", result_available: false });
  });
  mount();
  const user = await prepareDraft();
  await user.click(screen.getByRole("button", { name: "生成语音" }));
  await screen.findByText(
    "任务已提交，记录刷新失败。请刷新记录核对，不要重复提交。",
  );
  expect(
    screen.getByRole("article", { name: "选中的生成结果" }),
  ).toHaveTextContent("正在生成");
  expect(screen.getByRole("button", { name: "生成语音" })).toBeDisabled();
});

test("reference import and replacement keep the new file usable if old-file cleanup fails", async () => {
  mount();
  await prepareDraft();
  vi.mocked(speechApi.deleteInferenceAudio).mockRejectedValue(
    new Error("清理失败"),
  );
  await userEvent.click(screen.getByRole("button", { name: "从文件库选择" }));
  await userEvent.click(screen.getByRole("button", { name: "选择文件库录音" }));
  await screen.findByText("新参考录音已就绪，旧输入清理失败；可继续生成。");
  expect(speechApi.importInferenceAudio).toHaveBeenCalledWith("library-audio");
  await userEvent.click(screen.getByRole("button", { name: "生成语音" }));
  await waitFor(() =>
    expect(speechApi.createSpeechTask).toHaveBeenCalledWith(
      "m",
      expect.any(String),
      "Chinese",
      expect.objectContaining({ id: "library-ref" }),
      expect.any(String),
    ),
  );
});

test("file type and size validation leaves an existing valid reference selected", async () => {
  mount();
  await prepareDraft();
  const user = userEvent.setup({ applyAccept: false });
  await user.upload(
    screen.getByLabelText("参考录音"),
    new File(["bad"], "bad.exe"),
  );
  await screen.findByText("请选择 .wav / .mp3 格式的录音");
  expect(screen.getByText(reference.filename)).toBeInTheDocument();
  expect(speechApi.uploadInferenceAudio).toHaveBeenCalledTimes(1);
  const large = new File(["audio"], "large.wav", { type: "audio/wav" });
  Object.defineProperty(large, "size", { value: 21 * 1024 ** 2 });
  await user.upload(screen.getByLabelText("参考录音"), large);
  await screen.findByText("参考录音超过大小限制");
  expect(speechApi.uploadInferenceAudio).toHaveBeenCalledTimes(1);
});

test("pending submission blocks a double click", async () => {
  let finish!: (task: InferenceTask) => void;
  vi.mocked(speechApi.createSpeechTask).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  const user = await prepareDraft();
  await user.dblClick(screen.getByRole("button", { name: "生成语音" }));
  expect(speechApi.createSpeechTask).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "正在处理…" })).toBeDisabled();
  await act(async () => finish(result()));
});

test("result audio supports playback, pause, real duration and seeking", async () => {
  records = [result()];
  const view = mount();
  const play = await screen.findByRole("button", { name: "播放语音" });
  const audio = view.container.querySelector("audio")!;
  Object.defineProperty(audio, "duration", { value: 8, configurable: true });
  fireEvent.loadedMetadata(audio);
  expect(screen.getByText("00:08")).toBeInTheDocument();
  await userEvent.click(play);
  expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "播放位置" }), {
    target: { value: "4" },
  });
  expect(audio.currentTime).toBe(4);
  expect(screen.getByText("00:04")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "暂停" }));
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "下载 WAV" })).toHaveAttribute(
    "download",
    "speech.wav",
  );
});

test("save has pending, success and permission states", async () => {
  records = [result()];
  const view = mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "保存到文件库" }),
  );
  expect(
    await screen.findByRole("button", { name: "已保存到文件库" }),
  ).toBeDisabled();
  expect(speechApi.saveSpeechTask).toHaveBeenCalledTimes(1);
  view.unmount();
  mount(["models.use", "content.read"]);
  expect(
    await screen.findByRole("button", { name: "保存到文件库" }),
  ).toBeDisabled();
  expect(screen.getByRole("link", { name: "下载 WAV" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "上传参考录音" })).toBeDisabled();
});

test("history filters by model and switching records changes the sole audio player", async () => {
  records = [
    result(),
    result({ id: "older", request_payload: { text: "更早的文稿" } }),
    result({
      id: "other-model",
      model_id: "different",
      request_payload: { text: "不属于当前模型" },
    }),
  ];
  const view = mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "试听生成记录：更早的文稿" }),
  );
  expect(
    within(screen.getByRole("article", { name: "选中的生成结果" })).getByText(
      "更早的文稿",
    ),
  ).toBeInTheDocument();
  expect(view.container.querySelectorAll("audio")).toHaveLength(1);
  expect(screen.queryByText("不属于当前模型")).toBeNull();
});

test("failed tasks have an understandable status without playback actions", async () => {
  records = [
    result({
      status: "failed",
      result_available: false,
      error_message: "参考录音无法解码",
    }),
  ];
  mount();
  await within(
    await screen.findByRole("article", { name: "选中的生成结果" }),
  ).findByText("生成失败");
  expect(screen.getByText("参考录音无法解码")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "播放语音" })).toBeNull();
});

test("workspace changes reset drafts and old submissions cannot refill the new cache", async () => {
  let finish!: (task: InferenceTask) => void;
  vi.mocked(speechApi.createSpeechTask).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  const user = await prepareDraft();
  await user.click(screen.getByRole("button", { name: "生成语音" }));
  await act(async () => {
    view.client.clear();
    view.switchAccount("new-workspace");
  });
  await act(async () => finish(result()));
  expect(screen.getByLabelText("目标文字")).toHaveValue("");
  expect(
    view.client.getQueryData<{ items: InferenceTask[] }>(
      modelQueryKeys.inferenceTasks,
    )?.items ?? [],
  ).toEqual([]);
});
