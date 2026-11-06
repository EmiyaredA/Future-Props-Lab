import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ModelTestPage } from "@features/models/conversation";
import {
  createModelTestConversation,
  createModelTestGenerationTask,
  deleteModelTestGenerationTask,
  deleteModelTestReferenceAsset,
  deleteModelTestAttachment,
  getModelTestConversation,
  getModelTestConversations,
  getModelTestGenerationResult,
  getModelTestGenerationTasks,
  streamModelTest,
  uploadModelTestAttachments,
  uploadModelTestReferenceAssets,
  type ModelTestConversation,
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
          label: "图像生成",
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

test("switches the unified workspace to video and submits custom controls", async () => {
  const user = userEvent.setup();
  const { container } = renderWithQuery(<ModelTestPage />);
  await screen.findByText("测试对话");

  await user.click(screen.getByRole("tab", { name: "视频生成" }));
  expect(
    await screen.findByPlaceholderText("描述镜头、动作和氛围…"),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("combobox", { name: "时长" }));
  await user.click(screen.getByRole("option", { name: "8 秒" }));
  await user.click(screen.getByRole("button", { name: "1080p" }));
  await user.click(screen.getByRole("button", { name: "9:16" }));
  await user.click(screen.getByRole("checkbox", { name: /生成音频/ }));
  await user.click(screen.getByRole("checkbox", { name: /保留水印/ }));
  await user.type(
    screen.getByPlaceholderText("描述镜头、动作和氛围…"),
    "海边公路上的复古汽车",
  );
  await user.click(screen.getByRole("button", { name: "开始测试" }));

  await waitFor(() =>
    expect(vi.mocked(createModelTestGenerationTask)).toHaveBeenLastCalledWith({
      kind: "video",
      model_id: "m-video",
      prompt: "海边公路上的复古汽车",
      duration: 8,
      resolution: "1080p",
      ratio: "9:16",
      watermark: false,
      generate_audio: true,
      reference_asset_ids: [],
      audio_asset_ids: [],
      video_asset_ids: [],
    }),
  );
  expect(container.querySelector("select")).toBeNull();
});

test("uploads reference audio and video with the video generation task", async () => {
  const createUrl = vi.fn((file: Blob) => `blob:${file.type}`);
  const revokeUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeUrl,
  });
  vi.mocked(uploadModelTestReferenceAssets).mockImplementation(
    async (files) => ({
      items: files.map((file) => ({
        id: file.type.startsWith("audio/") ? "asset-audio" : "asset-video",
        original_filename: file.name,
        media_kind: file.type.startsWith("audio/") ? "audio" : "video",
        mime_type: file.type,
        byte_size: file.size,
        claimed: false,
        created_at: "2026-08-03T00:00:00Z",
      })),
    }),
  );
  const user = userEvent.setup();
  renderWithQuery(<ModelTestPage />);
  await screen.findByText("测试对话");
  await user.click(screen.getByRole("tab", { name: "视频生成" }));

  const input = screen.getByLabelText("上传参考图片、音频或视频");
  const video = new File(["video"], "motion.mp4", { type: "video/mp4" });
  const audio = new File(["audio"], "rhythm.mp3", { type: "audio/mpeg" });
  await user.upload(input, [video, audio]);
  expect(screen.getByText("motion.mp4")).toBeInTheDocument();
  expect(screen.getByText("rhythm.mp3")).toBeInTheDocument();
  await user.type(
    screen.getByPlaceholderText("描述镜头、动作和氛围…"),
    "使用参考运镜和音乐节奏",
  );
  await user.click(screen.getByRole("button", { name: "开始测试" }));

  await waitFor(() =>
    expect(vi.mocked(createModelTestGenerationTask)).toHaveBeenLastCalledWith({
      kind: "video",
      model_id: "m-video",
      prompt: "使用参考运镜和音乐节奏",
      duration: 5,
      resolution: "720p",
      ratio: "16:9",
      watermark: true,
      generate_audio: false,
      reference_asset_ids: [],
      audio_asset_ids: ["asset-audio"],
      video_asset_ids: ["asset-video"],
    }),
  );
  expect(uploadModelTestReferenceAssets).toHaveBeenCalledTimes(1);
  expect(deleteModelTestReferenceAsset).not.toHaveBeenCalled();
  expect(revokeUrl).toHaveBeenCalledWith("blob:video/mp4");
  expect(revokeUrl).toHaveBeenCalledWith("blob:audio/mpeg");
});

test("filters generation history and releases result object URLs", async () => {
  const task = {
    id: "task-completed",
    provider_id: "p-image",
    model_id: "m-image",
    provider_kind: "senseaudio_image" as const,
    kind: "image" as const,
    provider_name: "图片供应商",
    model_slug: "senseaudio-image-2.0-260319",
    request_payload: { prompt: "日落海岸", size: "1024x1024", seed: null },
    status: "completed" as const,
    progress: 100,
    error_message: null,
    result_filename: "sunset.png",
    result_mime_type: "image/png",
    result_byte_size: 6,
    result_available: true,
    can_retry_materialization: false,
    log_id: "log-1",
    revision: 1,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:08Z",
    completed_at: "2026-08-03T00:00:08Z",
  };
  vi.mocked(getModelTestGenerationTasks).mockResolvedValueOnce({
    items: [task],
    total: 1,
  });
  vi.mocked(getModelTestGenerationResult).mockResolvedValue(
    new Blob(["image"], { type: "image/png" }),
  );
  const createObjectUrl = vi
    .fn()
    .mockReturnValueOnce("blob:active-result")
    .mockReturnValueOnce("blob:history-thumbnail");
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
  const view = renderWithQuery(<ModelTestPage />);
  await screen.findByText("测试对话");
  await user.click(screen.getByRole("tab", { name: "图像生成" }));
  expect(
    await screen.findByRole("button", { name: /日落海岸/ }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("link", { name: "下载生成结果" }),
  ).toHaveAttribute("download", "sunset.png");

  await user.type(
    screen.getByRole("searchbox", { name: "搜索生成任务" }),
    "雨夜",
  );
  expect(screen.queryByRole("button", { name: /日落海岸/ })).toBeNull();
  expect(screen.getByText("没有匹配的任务")).toBeInTheDocument();

  await user.clear(screen.getByRole("searchbox", { name: "搜索生成任务" }));
  await user.click(screen.getByRole("button", { name: "删除测试记录" }));
  await waitFor(() =>
    expect(vi.mocked(deleteModelTestGenerationTask)).toHaveBeenCalledWith(
      "task-completed",
      1,
    ),
  );
  view.unmount();
  expect(revokeObjectUrl).toHaveBeenCalled();
});

test("filters conversations locally", async () => {
  vi.mocked(getModelTestConversations).mockResolvedValueOnce({
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
      {
        id: "c2",
        title: "代码效果",
        model_id: "m1",
        model_slug: "model-x",
        revision: 1,
        created_at: "2026-08-03T00:00:00Z",
        updated_at: "2026-08-03T00:00:00Z",
      },
    ],
  });
  const user = userEvent.setup();
  renderWithQuery(<ModelTestPage />);
  expect(await screen.findByText("代码效果")).toBeInTheDocument();
  expect(screen.getByText("共 2 个对话")).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "搜索对话" }), "代码");
  expect(screen.queryByText("测试对话")).not.toBeInTheDocument();
  expect(screen.getByText("代码效果")).toBeInTheDocument();
});

test("keeps raw provider errors inside the detail dialog", async () => {
  const rawError =
    "Client error '401 Unauthorized' for url 'https://api.example.test/v1/chat/completions'";
  vi.mocked(getModelTestConversation).mockResolvedValueOnce({
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
        id: "msg-error",
        turn_id: "t-error",
        role: "assistant",
        content: "",
        model_slug: "model-x",
        status: "error",
        error_message: rawError,
        created_at: "2026-08-03T00:00:00Z",
      },
    ],
  });
  const user = userEvent.setup();
  renderWithQuery(<ModelTestPage />);
  expect(await screen.findByText("认证失败")).toBeInTheDocument();
  expect(screen.queryByText(rawError)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看详情" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(rawError);
});

test("uploads, previews, sends and removes private image drafts", async () => {
  const attachment = {
    id: "attachment-1",
    original_filename: "screen.png",
    mime_type: "image/png" as const,
    byte_size: 68,
    width: 4,
    height: 3,
    created_at: "2026-08-03T00:00:00Z",
  };
  let detail: ModelTestConversation = {
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
    messages: [],
    draft_attachments: [],
  };
  vi.mocked(getModelTestConversation).mockImplementation(async () => detail);
  vi.mocked(uploadModelTestAttachments).mockImplementation(async () => {
    detail = { ...detail, draft_attachments: [attachment] };
    return { items: [attachment] };
  });
  vi.mocked(deleteModelTestAttachment).mockImplementation(async () => {
    detail = { ...detail, draft_attachments: [] };
    return { deleted: true };
  });
  const createObjectUrl = vi.fn(() => "blob:model-test-image");
  const revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(new Blob(["image"], { type: "image/png" }), {
        status: 200,
      }),
    ),
  );
  const user = userEvent.setup();
  const { container } = renderWithQuery(<ModelTestPage />);
  const input = await waitFor(() => {
    const element =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(element).not.toBeNull();
    return element as HTMLInputElement;
  });
  await user.upload(
    input,
    new File(["image"], "screen.png", { type: "image/png" }),
  );
  await waitFor(() =>
    expect(uploadModelTestAttachments).toHaveBeenCalledWith(
      "c1",
      expect.arrayContaining([expect.objectContaining({ name: "screen.png" })]),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText(/查看图片 screen\.png/)).toBeEnabled(),
  );
  expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() =>
    expect(streamModelTest).toHaveBeenCalledWith(
      "c1",
      {
        expected_revision: 2,
        content: "",
        attachment_ids: ["attachment-1"],
      },
      false,
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );

  await user.click(screen.getByRole("button", { name: "移除图片 screen.png" }));
  await waitFor(() =>
    expect(deleteModelTestAttachment).toHaveBeenCalledWith(
      "c1",
      "attachment-1",
    ),
  );
  expect(
    screen.queryByRole("button", { name: "移除图片 screen.png" }),
  ).not.toBeInTheDocument();
  vi.unstubAllGlobals();
});

test("shows a stopped reply as a status bubble without typing or failure UI", async () => {
  vi.mocked(getModelTestConversation).mockResolvedValue({
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
    messages: [
      {
        id: "msg-stopped",
        turn_id: "t-stopped",
        role: "assistant",
        content: "",
        model_slug: "model-x",
        status: "cancelled",
        error_message: "用户停止生成",
        created_at: "2026-08-03T00:00:00Z",
      },
    ],
  });

  renderWithQuery(<ModelTestPage />);

  expect(await screen.findByText("已停止")).toBeInTheDocument();
  expect(screen.queryByLabelText("正在生成")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText("模型调用失败")).not.toBeInTheDocument();
});

test("switches an active reply to stopped immediately when stop is clicked", async () => {
  let detail: ModelTestConversation = {
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
    messages: [],
  };
  vi.mocked(getModelTestConversation).mockImplementation(async () => detail);
  vi.mocked(streamModelTest).mockImplementation(
    async (_id, _body, _regenerate, signal, onEvent) => {
      detail = {
        ...detail,
        revision: 3,
        messages: [
          {
            id: "msg-streaming",
            turn_id: "t-streaming",
            role: "assistant",
            content: "",
            model_slug: "model-x",
            status: "pending",
            error_message: null,
            created_at: "2026-08-03T00:00:00Z",
          },
        ],
      };
      onEvent({
        type: "start",
        schema_version: 2,
        sequence: 0,
        payload: { assistant_message_id: "msg-streaming" },
      });
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    },
  );
  const user = userEvent.setup();
  renderWithQuery(<ModelTestPage />);
  const input = await screen.findByPlaceholderText("输入要测试的问题");
  await user.type(input, "请回复一段内容");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(await screen.findByText("正在回复")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "停止生成" }));

  await waitFor(() => expect(screen.getByText("已停止")).toBeInTheDocument());
  expect(screen.queryByText("正在回复")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("正在生成")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("opens a newly created conversation before the history refresh finishes", async () => {
  const previousConversation: ModelTestConversation = {
    id: "c1",
    title: "原对话",
    model_id: "m1",
    model_slug: "model-x",
    revision: 2,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
    system_prompt: "",
    temperature: 0.7,
    max_tokens: 1024,
    messages: [],
    draft_attachments: [],
  };
  const newConversation: ModelTestConversation = {
    ...previousConversation,
    id: "c2",
    title: "新对话",
    revision: 1,
    created_at: "2026-08-03T01:00:00Z",
    updated_at: "2026-08-03T01:00:00Z",
  };
  let resolveRefresh: (
    value: Awaited<ReturnType<typeof getModelTestConversations>>,
  ) => void = () => undefined;
  const pendingRefresh = new Promise<
    Awaited<ReturnType<typeof getModelTestConversations>>
  >((resolve) => {
    resolveRefresh = resolve;
  });
  const listCallsBeforeRender = vi.mocked(getModelTestConversations).mock.calls
    .length;

  vi.mocked(getModelTestConversations)
    .mockResolvedValueOnce({ items: [previousConversation] })
    .mockReturnValueOnce(pendingRefresh);
  vi.mocked(createModelTestConversation).mockResolvedValueOnce(newConversation);
  vi.mocked(getModelTestConversation).mockImplementation(async (id) =>
    id === newConversation.id ? newConversation : previousConversation,
  );

  const user = userEvent.setup();
  renderWithQuery(<ModelTestPage />);
  expect(await screen.findByDisplayValue("原对话")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "新建对话" }));

  expect(await screen.findByDisplayValue("新对话")).toBeInTheDocument();
  expect(screen.getByText("开始一次模型测试")).toBeInTheDocument();

  resolveRefresh({ items: [newConversation, previousConversation] });
  await waitFor(() =>
    expect(getModelTestConversations).toHaveBeenCalledTimes(
      listCallsBeforeRender + 2,
    ),
  );
});
