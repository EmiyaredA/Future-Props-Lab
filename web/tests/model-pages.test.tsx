import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { importAudioAnnotationTranscriptionTask } from "@features/audio-annotation";
import { ModelServicePage } from "@features/models/catalog";
import { ModelTestPage } from "@features/models/conversation";
import { ModelCallLogsPage } from "@features/models/logs";
import {
  createModelTestGenerationTask,
  createModelTestTranscriptionFromLibrary,
  deleteModelTestTranscriptionTask,
  getLog,
  getLogs,
  getModelTestTranscriptionTasks,
  patchModelTestConversation,
  uploadModelTestTranscription,
} from "@features/models/api";

vi.mock("@features/audio-annotation", async () => {
  const actual = await vi.importActual<
    typeof import("@features/audio-annotation")
  >("@features/audio-annotation");
  return {
    ...actual,
    importAudioAnnotationTranscriptionTask: vi.fn().mockResolvedValue({
      id: "annotation-import",
    }),
  };
});

vi.mock("@features/models/api", async () => {
  const actual = await vi.importActual<typeof import("@features/models/api")>(
    "@features/models/api",
  );
  return {
    ...actual,
    getCatalog: vi.fn().mockResolvedValue({
      default_model_ids: {},
      revision: 2,
      providers: [
        {
          id: "p1",
          name: "主模型网关",
          kind: "openai",
          base_url: "https://example.test/v1",
          enabled: true,
          has_api_key: true,
          api_key_hint: "1234",
          models: [
            {
              id: "m1",
              provider_id: "p1",
              slug: "model-x",
              label: "Model X",
              description: "",
              capabilities: ["chat", "vision"],
              categories: ["text_generation"],
              enabled: true,
            },
          ],
        },
        {
          id: "p-asr",
          name: "语音识别供应商",
          kind: "senseaudio_asr",
          base_url: "https://example.test/v1",
          enabled: true,
          has_api_key: true,
          api_key_hint: "3456",
          models: [
            {
              id: "m-asr",
              provider_id: "p-asr",
              slug: "senseaudio-asr-pro-1.5-260319",
              label: "SenseAudio ASR",
              description: "说话人识别与时间戳",
              capabilities: ["speech_recognition"],
              categories: ["speech_recognition"],
              enabled: true,
            },
            {
              id: "m-asr-custom",
              provider_id: "p-asr",
              slug: "pro-asr",
              label: "Custom Pro ASR",
              description: "自定义专业识别端点",
              capabilities: ["speech_recognition"],
              categories: ["speech_recognition"],
              enabled: true,
            },
          ],
        },
        {
          id: "p-image",
          name: "图片供应商",
          kind: "senseaudio_image",
          base_url: "https://example.test/v1",
          enabled: true,
          has_api_key: true,
          api_key_hint: "5678",
          models: [
            {
              id: "m-image",
              provider_id: "p-image",
              slug: "senseaudio-image-2.0-260319",
              label: "Image Model",
              description: "图片生成模型",
              capabilities: ["image_generation"],
              categories: ["image_generation"],
              enabled: true,
            },
          ],
        },
        {
          id: "p-video",
          name: "视频供应商",
          kind: "senseaudio_video",
          base_url: "https://example.test/v1",
          enabled: true,
          has_api_key: true,
          api_key_hint: "9012",
          models: [
            {
              id: "m-video",
              provider_id: "p-video",
              slug: "senseaudio-video-1.0",
              label: "Video Model",
              description: "视频生成模型",
              capabilities: ["video_generation"],
              categories: ["video_generation"],
              enabled: true,
            },
          ],
        },
      ],
    }),
    getModelCategories: vi.fn().mockResolvedValue({
      items: [
        {
          id: "text_generation",
          label: "文本生成",
          type: "text",
          sub_type: "chat",
        },
        {
          id: "image_generation",
          label: "图片生成",
          type: "image",
          sub_type: "text-to-image",
        },
        {
          id: "video_generation",
          label: "视频生成",
          type: "video",
          sub_type: "text-to-video",
        },
      ],
    }),
    getModelTestGenerationOptions: vi.fn().mockResolvedValue({
      items: [
        {
          id: "m-image",
          provider_id: "p-image",
          provider_name: "图片供应商",
          kind: "image",
          slug: "senseaudio-image-2.0-260319",
          label: "Image Model",
          description: "图片生成模型",
          sizes: ["1024x1024"],
        },
        {
          id: "m-video",
          provider_id: "p-video",
          provider_name: "视频供应商",
          kind: "video",
          slug: "senseaudio-video-1.0",
          label: "Video Model",
          description: "视频生成模型",
          sizes: [],
        },
      ],
    }),
    getModelTestGenerationTasks: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0 }),
    getModelTestTranscriptionOptions: vi.fn().mockResolvedValue({
      items: [
        {
          id: "m-asr",
          provider_id: "p-asr",
          provider_name: "语音识别供应商",
          provider_kind: "senseaudio_asr",
          slug: "senseaudio-asr-pro-1.5-260319",
          label: "SenseAudio ASR",
          description: "说话人识别与时间戳",
          max_input_bytes: 100 * 1024 * 1024,
          parameter_capabilities: {
            language_mode: "select",
            language_options: [
              { value: "auto", label: "自动识别" },
              { value: "zh", label: "中文" },
              { value: "ja", label: "日语" },
            ],
            target_language_options: [
              { value: "zh", label: "中文" },
              { value: "en", label: "英语" },
            ],
            supports_word_timestamps: true,
            supports_text_edit: false,
            supports_speaker_diarization: true,
            supports_max_speakers: true,
            supports_punctuation: true,
            supports_hotwords: false,
            supports_abbreviations: true,
            defaults: {
              language: "auto",
              target_language: null,
              enable_word_timestamps: false,
              enable_text_edit: false,
              enable_speaker_diarization: true,
              max_speakers: null,
              enable_punctuation: true,
              hotwords: null,
              abbreviations: false,
            },
          },
        },
        {
          id: "m-asr-custom",
          provider_id: "p-asr",
          provider_name: "语音识别供应商",
          provider_kind: "senseaudio_asr",
          slug: "pro-asr",
          label: "Custom Pro ASR",
          description: "自定义专业识别端点",
          max_input_bytes: 100 * 1024 * 1024,
          parameter_capabilities: {
            language_mode: "candidates",
            language_options: [
              { value: "auto", label: "自动识别" },
              { value: "Chinese", label: "简体中文" },
              { value: "English", label: "English" },
            ],
            target_language_options: [
              { value: "Chinese", label: "简体中文" },
              { value: "English", label: "English" },
            ],
            supports_word_timestamps: true,
            supports_text_edit: true,
            supports_speaker_diarization: true,
            supports_max_speakers: false,
            supports_punctuation: false,
            supports_hotwords: false,
            supports_abbreviations: false,
            defaults: {
              language: "auto",
              target_language: null,
              enable_word_timestamps: false,
              enable_text_edit: true,
              enable_speaker_diarization: true,
              max_speakers: null,
              enable_punctuation: false,
              hotwords: null,
              abbreviations: false,
            },
          },
        },
      ],
      max_input_bytes: 10 * 1024 * 1024,
      accepted_extensions: [".mp3", ".wav", ".m4a", ".ogg"],
      accepted_mime_types: ["audio/mpeg", "audio/wav", "audio/ogg"],
    }),
    getModelTestTranscriptionTasks: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0 }),
    uploadModelTestTranscription: vi.fn().mockResolvedValue({
      id: "transcription-upload",
      status: "queued",
    }),
    createModelTestTranscriptionFromLibrary: vi.fn().mockResolvedValue({
      id: "transcription-library",
      status: "queued",
    }),
    deleteModelTestTranscriptionTask: vi
      .fn()
      .mockResolvedValue({ deleted: true }),
    getModelTestTranscriptionAudio: vi
      .fn()
      .mockResolvedValue(new Blob(["audio"], { type: "audio/mpeg" })),
    getModelTestLibraryFolders: vi.fn().mockResolvedValue({
      items: [
        {
          id: "folder-audio",
          project_id: null,
          parent_id: null,
          name: "广播剧",
          revision: 0,
          created_at: "2026-08-03T00:00:00Z",
          updated_at: "2026-08-03T00:00:00Z",
        },
      ],
    }),
    getModelTestLibraryAudioFiles: vi.fn().mockResolvedValue({
      items: [
        {
          id: "audio-small",
          project_id: null,
          folder_id: null,
          original_filename: "episode.ogg",
          display_name: "广播剧片段",
          media_kind: "audio",
          mime_type: "audio/ogg",
          byte_size: 2048,
          revision: 0,
          created_at: "2026-08-03T00:00:00Z",
          updated_at: "2026-08-03T00:00:00Z",
          source: "library",
          is_reference: false,
          reference_id: null,
        },
        {
          id: "audio-large",
          project_id: null,
          folder_id: null,
          original_filename: "full-drama.mp3",
          display_name: "完整广播剧",
          media_kind: "audio",
          mime_type: "audio/mpeg",
          byte_size: 28.7 * 1024 * 1024,
          revision: 0,
          created_at: "2026-08-03T00:00:00Z",
          updated_at: "2026-08-03T00:00:00Z",
          source: "library",
          is_reference: false,
          reference_id: null,
        },
      ],
    }),
    createModelTestGenerationTask: vi.fn().mockResolvedValue({
      id: "task-image",
      provider_id: "p-image",
      model_id: "m-image",
      provider_kind: "senseaudio_image",
      kind: "image",
      provider_name: "图片供应商",
      model_slug: "senseaudio-image-2.0-260319",
      request_payload: { prompt: "未来城市", size: "1024x1024", seed: null },
      status: "queued",
      progress: 0,
      error_message: null,
      result_filename: null,
      result_mime_type: null,
      result_byte_size: null,
      result_available: false,
      can_retry_materialization: false,
      log_id: null,
      revision: 0,
      created_at: "2026-08-03T00:00:00Z",
      updated_at: "2026-08-03T00:00:00Z",
      completed_at: null,
    }),
    getModelTestGenerationResult: vi
      .fn()
      .mockResolvedValue(new Blob(["result"], { type: "image/png" })),
    deleteModelTestGenerationTask: vi.fn().mockResolvedValue({ deleted: true }),
    retryModelTestGenerationMaterialization: vi.fn(),
    getLogs: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 }),
    getLog: vi.fn(),
    getLogStats: vi.fn().mockResolvedValue({
      calls_today: 0,
      total_tokens_today: 0,
      avg_latency_ms_today: 0,
      errors_today: 0,
    }),
    getModelTestConversations: vi.fn().mockResolvedValue({
      items: [
        {
          id: "c1",
          title: "测试对话",
          model_id: "m1",
          model_slug: "model-x",
          revision: 2,
          created_at: "2026-08-03T00:00:00Z",
          updated_at: "2026-08-03T00:00:00Z",
        },
      ],
    }),
    createModelTestConversation: vi.fn(),
    getModelTestConversation: vi.fn().mockResolvedValue({
      id: "c1",
      title: "测试对话",
      model_id: "m1",
      model_slug: "model-x",
      revision: 2,
      created_at: "2026-08-03T00:00:00Z",
      updated_at: "2026-08-03T00:00:00Z",
      system_prompt: "",
      temperature: 0.7,
      max_tokens: 1024,
      messages: [
        {
          id: "msg1",
          turn_id: "t1",
          role: "assistant",
          content:
            "**安全 Markdown** <img src=x onerror=alert(1)>\n\n```python\ndef hello():\n    print('ok')\n```",
          model_slug: "model-x",
          status: "completed",
          error_message: null,
          created_at: "2026-08-03T00:00:00Z",
        },
      ],
    }),
    patchModelTestConversation: vi.fn().mockResolvedValue({
      id: "c1",
      title: "测试对话",
      model_id: "m1",
      model_slug: "model-x",
      revision: 3,
      created_at: "2026-08-03T00:00:00Z",
      updated_at: "2026-08-03T00:00:00Z",
      system_prompt: "",
      temperature: 0.7,
      max_tokens: 1024,
      messages: [],
    }),
    uploadModelTestAttachments: vi.fn(),
    uploadModelTestReferenceAssets: vi.fn(),
    cleanupModelTestReferenceAssets: vi.fn().mockResolvedValue({
      deleted_assets: 0,
      deleted_orphan_files: 0,
    }),
    getModelTestReferenceBackfillStatus: vi.fn().mockResolvedValue({
      pending_tasks: 0,
      eligible_tasks: 0,
      active_tasks: 0,
      missing_files: 0,
    }),
    backfillModelTestReferenceAssets: vi.fn(),
    deleteModelTestReferenceAsset: vi.fn().mockResolvedValue({ deleted: true }),
    deleteModelTestAttachment: vi.fn().mockResolvedValue({ deleted: true }),
    streamModelTest: vi.fn().mockResolvedValue(undefined),
  };
});

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function readBlobText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Blob read failed"));
    reader.readAsText(blob);
  });
}

test("shows provider catalog categories without the redundant diagnostics entry", async () => {
  const { container } = renderWithQuery(<ModelServicePage />);
  expect(await screen.findByText("主模型网关")).toBeInTheDocument();
  expect(await screen.findByText("Model X")).toBeInTheDocument();
  expect(container.querySelector(".model-glyph")).toBeNull();
  expect(screen.getByText("支持能力")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "对话" })).toBeInTheDocument();
  expect(screen.getByText("状态")).toBeInTheDocument();
  expect(screen.getAllByText("已启用")).toHaveLength(5);
  expect(screen.queryByRole("button", { name: "测试调用" })).toBeNull();
  expect(screen.queryByText("查看模型测试产生的调用日志")).toBeNull();
});

test("does not repeat a capability that is already shown as a category", async () => {
  const user = userEvent.setup();
  renderWithQuery(<ModelServicePage />);
  await user.click(await screen.findByRole("tab", { name: "图片" }));
  expect(screen.getAllByText("图片生成")).toHaveLength(1);
});

test("offers the SenseAudio speaker recognition provider and ASR capability", async () => {
  const user = userEvent.setup();
  renderWithQuery(<ModelServicePage />);
  await screen.findByText("主模型网关");

  await user.click(screen.getByRole("tab", { name: "接入管理" }));
  await user.click(screen.getAllByRole("button", { name: "添加连接" })[0]);
  await user.click(screen.getByRole("combobox", { name: "接入协议" }));
  expect(
    screen.getByRole("option", { name: "SenseAudio 专业说话人识别" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "关闭" }));

  await user.click(screen.getByRole("tab", { name: "模型目录" }));
  await user.click(screen.getByRole("button", { name: /添加模型/ }));
  expect(screen.getByRole("button", { name: "语音识别" })).toBeInTheDocument();
});

test("shows a useful empty state for call logs", async () => {
  renderWithQuery(
    <ModelCallLogsPage
      currentWorkspace={{ id: "default", name: "测试工作区" }}
    />,
  );
  expect(await screen.findByText("暂无调用日志")).toBeInTheDocument();
  expect(
    screen.getByText("调整筛选条件，或在模型测试及工坊中发起调用。"),
  ).toBeInTheDocument();
});

test("renders call log payloads as a readable role-based message trace", async () => {
  const user = userEvent.setup();
  vi.mocked(getLogs).mockResolvedValueOnce({
    items: [
      {
        id: "log-1",
        call_source: "model_playground",
        provider_kind: "openai",
        model: "model-x",
        trace_id: "trace-1",
        total_tokens: 41,
        latency_ms: 820,
        status: "success",
        created_at: "2026-08-04T07:43:52Z",
      },
    ],
    total: 1,
    page: 1,
    page_size: 25,
  });
  vi.mocked(getLog).mockResolvedValueOnce({
    id: "log-1",
    call_source: "model_playground",
    provider_kind: "openai",
    model: "model-x",
    trace_id: "trace-1",
    request_payload: {
      system: "回答要简洁准确。",
      messages: [{ role: "user", content: "如何查询 API 的请求参数？" }],
      temperature: 0.7,
    },
    response_payload: {
      content: "请先查看接口文档中的参数表。",
      status: "completed",
      finish_reason: "stop",
      first_token_latency_ms: 120,
      rounds: 1,
      actions: [{ tool_name: "search_docs", status: "completed" }],
    },
    prompt_tokens: 29,
    completion_tokens: 12,
    total_tokens: 41,
    latency_ms: 820,
    status: "success",
    error_message: null,
    ...{ reproduction_supported: true, reproduction_reason: "" },
    created_at: "2026-08-04T07:43:52Z",
  });
  const { container } = renderWithQuery(
    <ModelCallLogsPage
      currentWorkspace={{ id: "default", name: "测试工作区" }}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "查看" }));

  expect(
    await screen.findByRole("dialog", { name: "调用详情" }),
  ).toBeInTheDocument();
  expect(screen.getByText("系统指令")).toBeInTheDocument();
  expect(screen.getByText("回答要简洁准确。")).toBeInTheDocument();
  expect(screen.getByText("如何查询 API 的请求参数？")).toBeInTheDocument();
  expect(screen.getByText("请先查看接口文档中的参数表。")).toBeInTheDocument();
  expect(screen.getByText("2 条消息")).toBeInTheDocument();
  expect(screen.getByText("请求上下文")).toBeInTheDocument();
  expect(screen.getByText("模型回复")).toBeInTheDocument();
  expect(screen.getByText("Token 与耗时")).toBeInTheDocument();
  expect(
    screen.getByText("Prompt Tokens").nextElementSibling,
  ).toHaveTextContent("29");
  expect(
    screen.getByText("Completion Tokens").nextElementSibling,
  ).toHaveTextContent("12");
  expect(screen.getByText("首 Token").nextElementSibling).toHaveTextContent(
    "120 ms",
  );
  expect(screen.getByText("TOOL_CALLS")).toBeInTheDocument();
  expect(screen.getByText("stop")).toBeInTheDocument();
  expect(container.querySelectorAll(".trace-message")).toHaveLength(2);
  expect(
    screen.getByRole("button", { name: "复制 Trace ID" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "JSON" }));
  expect(screen.getAllByText(/"temperature": 0.7/)).not.toHaveLength(0);
});

test("renders persistent model test workspace with safe markdown", async () => {
  const user = userEvent.setup();
  const { container } = renderWithQuery(<ModelTestPage />);
  expect(await screen.findByText("测试对话")).toBeInTheDocument();
  expect(await screen.findByText("安全 Markdown")).toBeInTheDocument();
  expect(screen.getByText("当前模型 · model-x")).toHaveAttribute(
    "title",
    "model-x",
  );
  expect(
    screen.getByRole("combobox", { name: "测试模型" }),
  ).toBeInTheDocument();
  const copyCodeButton = screen.getByRole("button", { name: "复制代码" });
  expect(copyCodeButton).toBeInTheDocument();
  expect(container.querySelector("code.hljs")).toBeInTheDocument();
  expect(container.querySelector(".hljs-keyword")).toHaveTextContent("def");
  await user.click(copyCodeButton);
  expect(await navigator.clipboard.readText()).toBe(
    "def hello():\n    print('ok')",
  );
  expect(
    screen.getByRole("button", { name: "复制原始输出" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "恢复默认参数" }));
  expect(vi.mocked(patchModelTestConversation)).toHaveBeenCalledWith("c1", 2, {
    system_prompt: "",
    temperature: 0.7,
    max_tokens: 1024,
  });
  expect(container.querySelector("select")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
});

test("switches the shared model selector to an image generation test", async () => {
  const user = userEvent.setup();
  const { container } = renderWithQuery(<ModelTestPage />);
  await screen.findByText("测试对话");
  await user.click(screen.getByRole("tab", { name: "图片生成" }));
  expect(await screen.findByText("最近任务")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "图片生成" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: "语音识别" })).toBeEnabled();
  expect(container.querySelector("select")).toBeNull();
  await user.type(screen.getByPlaceholderText("描述要生成的画面…"), "未来城市");
  await user.click(screen.getByRole("button", { name: "开始测试" }));
  await waitFor(() =>
    expect(vi.mocked(createModelTestGenerationTask)).toHaveBeenCalledWith({
      kind: "image",
      model_id: "m-image",
      prompt: "未来城市",
      size: "1024x1024",
      seed: null,
    }),
  );
});

test("runs speech recognition with a custom player and speaker timestamps", async () => {
  const task = {
    id: "transcription-completed",
    provider_id: "p-asr",
    model_id: "m-asr",
    provider_kind: "senseaudio_asr" as const,
    provider_name: "语音识别供应商",
    model_slug: "senseaudio-asr-pro-1.5-260319",
    language: "zh" as const,
    parameters: {
      language: "zh",
      target_language: "en",
      enable_word_timestamps: true,
      enable_text_edit: false,
      enable_speaker_diarization: true,
      max_speakers: 2,
      enable_punctuation: true,
      hotwords: null,
      abbreviations: false,
    },
    status: "completed" as const,
    source: {
      kind: "upload" as const,
      source_asset_id: null,
      filename: "episode.mp3",
      mime_type: "audio/mpeg",
      byte_size: 2048,
      available: true,
    },
    result_text: "你好，欢迎收听。",
    result_segments: [
      {
        speaker: "speaker_0",
        start_ms: 0,
        end_ms: 1250,
        text: "你好。",
        translation: "Hello.",
        speaker_candidates: ["speaker_0", "speaker_1"],
        is_overlap: true,
      },
      {
        speaker: "speaker_1",
        start_ms: 1250,
        end_ms: 2600,
        text: "欢迎收听。",
        is_overlap: false,
      },
      {
        speaker: "speaker_2",
        start_ms: 2600,
        end_ms: 2699,
        text: "短片段",
        is_overlap: false,
      },
    ],
    result_detail: {
      processing_status: "degraded" as const,
      words: [{ word: "你好", start_ms: 0, end_ms: 500 }],
      warnings: [
        {
          code: "speaker_fallback",
          message: "说话人识别已降级",
          stage: "diarization",
        },
      ],
      stages: [],
      overlap_intervals: [{ start_ms: 0, end_ms: 1250 }],
      audio_info: { duration_ms: 2600, format: "mp3" },
    },
    error_message: null,
    log_id: "log-asr",
    revision: 2,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:03Z",
    started_at: "2026-08-03T00:00:01Z",
    completed_at: "2026-08-03T00:00:03Z",
  };
  vi.mocked(getModelTestTranscriptionTasks).mockResolvedValueOnce({
    items: [task],
    total: 1,
  });
  const createObjectUrl = vi.fn().mockReturnValue("blob:transcription-audio");
  const revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
  });

  const user = userEvent.setup();
  const onOpenAudioAnnotation = vi.fn();
  const view = renderWithQuery(
    <ModelTestPage onOpenAudioAnnotation={onOpenAudioAnnotation} />,
  );
  await screen.findByText("测试对话");
  await user.click(screen.getByRole("tab", { name: "语音识别" }));

  expect(await screen.findByText("完整转写")).toBeInTheDocument();
  expect(screen.getByText("你好，欢迎收听。")).toBeInTheDocument();
  expect(screen.getByText("speaker_0")).toBeInTheDocument();
  expect(screen.getByText("00:00 – 00:01")).toBeInTheDocument();
  expect(screen.getByText("译文：Hello.")).toBeInTheDocument();
  expect(screen.getByText("重叠")).toBeInTheDocument();
  expect(
    screen.getByText("导入时会忽略 1 个短于 100 毫秒的识别片段"),
  ).toBeInTheDocument();
  expect(screen.getByText("说话人识别已降级")).toBeInTheDocument();
  expect(screen.getByText("字词时间戳（1 项）")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "播放音频" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "音频播放进度" })).toHaveValue("0");
  expect(screen.getByRole("slider", { name: "音频播放进度" })).toHaveAttribute(
    "max",
    "1",
  );
  expect(
    view.container.querySelector(".transcription-progress-track > i"),
  ).toHaveStyle({ width: "0%" });
  expect(view.container.querySelector("audio[controls]")).toBeNull();
  expect(view.container.querySelector("select")).toBeNull();
  const downloadClick = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  await user.click(screen.getByRole("button", { name: "导出 JSON" }));
  downloadClick.mockRestore();
  const exportedBlob = createObjectUrl.mock.calls
    .map(([blob]) => blob as Blob)
    .find((blob) => blob.type === "application/json;charset=utf-8");
  expect(exportedBlob).toBeDefined();
  expect(JSON.parse(await readBlobText(exportedBlob!))).toMatchObject({
    kind: "future-props-transcription",
    schema_version: "1.1",
    recognition: {
      task_id: task.id,
      text: "你好，欢迎收听。",
      parameters: { target_language: "en" },
      result_detail: { processing_status: "degraded" },
    },
  });
  await user.click(screen.getByRole("button", { name: "导入标注" }));
  await waitFor(() =>
    expect(
      vi.mocked(importAudioAnnotationTranscriptionTask),
    ).toHaveBeenCalledWith(task.id),
  );
  expect(onOpenAudioAnnotation).toHaveBeenCalledWith("annotation-import");
  await user.click(screen.getByRole("button", { name: "复制完整转写" }));
  expect(await navigator.clipboard.readText()).toBe("你好，欢迎收听。");
  await user.click(screen.getByRole("button", { name: "删除识别任务" }));
  await waitFor(() =>
    expect(vi.mocked(deleteModelTestTranscriptionTask)).toHaveBeenCalledWith(
      task,
    ),
  );
  view.unmount();
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:transcription-audio");
});

test("uses the selected Pro ASR model's 100 MB audio limit", async () => {
  const user = userEvent.setup();
  renderWithQuery(<ModelTestPage />);
  await screen.findByText("测试对话");
  await user.click(screen.getByRole("tab", { name: "语音识别" }));
  await user.click(
    await screen.findByRole("button", { name: /从文件管理选择/ }),
  );

  expect(
    await screen.findByRole("dialog", { name: "从文件管理选择音频" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /广播剧.*文件夹/ })).toBeEnabled();
  expect(screen.getByText("单文件最大 100 MB")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /完整广播剧/ })).toBeEnabled();
  expect(screen.getByText(/28\.7 MB/)).toBeInTheDocument();
  expect(screen.queryByText(/超过 10 MB/)).not.toBeInTheDocument();
  await user.type(
    screen.getByRole("searchbox", { name: "搜索文件管理音频" }),
    "片段",
  );
  await user.click(screen.getByRole("button", { name: /广播剧片段/ }));
  expect(screen.getByText(/2 KB · 文件管理/)).toBeInTheDocument();

  await user.click(screen.getByRole("combobox", { name: "识别语言" }));
  await user.click(screen.getByRole("option", { name: "日语" }));
  await user.click(screen.getByRole("button", { name: "开始识别" }));
  await waitFor(() =>
    expect(
      vi.mocked(createModelTestTranscriptionFromLibrary),
    ).toHaveBeenCalledWith("audio-small", "m-asr", {
      language: "ja",
      target_language: null,
      enable_word_timestamps: false,
      enable_text_edit: false,
      enable_speaker_diarization: true,
      max_speakers: null,
      enable_punctuation: true,
      hotwords: null,
      abbreviations: false,
    }),
  );
  expect(uploadModelTestTranscription).not.toHaveBeenCalled();
});

test("resets dynamic transcription controls when switching ASR models", async () => {
  const user = userEvent.setup();
  renderWithQuery(<ModelTestPage />);
  await screen.findByText("测试对话");
  await user.click(screen.getByRole("tab", { name: "语音识别" }));

  expect(screen.getByRole("switch", { name: /说话人识别/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(
    screen.getByRole("combobox", { name: "最大说话人数" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("switch", { name: /说话人识别/ }));
  expect(
    screen.queryByRole("combobox", { name: "最大说话人数" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("combobox", { name: "测试模型" }));
  await user.click(screen.getByRole("option", { name: /Custom Pro ASR/ }));
  const candidateInput = await screen.findByRole("textbox", {
    name: "识别语言",
  });
  expect(candidateInput).toHaveValue("auto");
  expect(screen.getByRole("switch", { name: /文本整理/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(
    screen.queryByRole("switch", { name: /自动标点/ }),
  ).not.toBeInTheDocument();
  await user.clear(candidateInput);
  await user.type(candidateInput, "Chinese,English");

  await user.click(screen.getByRole("combobox", { name: "测试模型" }));
  await user.click(screen.getByRole("option", { name: /SenseAudio ASR/ }));
  expect(
    await screen.findByRole("combobox", { name: "识别语言" }),
  ).toHaveTextContent("自动识别");
  expect(screen.getByRole("switch", { name: /自动标点/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(
    screen.queryByRole("switch", { name: /文本整理/ }),
  ).not.toBeInTheDocument();
});

test("read-only workspace users can inspect defaults without save controls", async () => {
  const user = userEvent.setup();
  renderWithQuery(<ModelServicePage canWrite={false} />);
  await user.click(await screen.findByRole("button", { name: "默认模型用途" }));
  expect(
    screen.getByRole("dialog", { name: "工作区默认模型" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "对话默认模型" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "保存更改" }),
  ).not.toBeInTheDocument();
});
