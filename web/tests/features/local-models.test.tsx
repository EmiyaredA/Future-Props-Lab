import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { SpeechSynthesisTestPanel } from "@features/models/generation/SpeechSynthesisTestPanel";
import * as localApi from "@features/models/localModelApi";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";

vi.mock("@features/models/localModelApi", () => ({
  getLocalModels: vi.fn(),
  localModelAction: vi.fn(),
  attachLocalModel: vi.fn(),
  getInferenceOptions: vi.fn(),
  getInferenceTasks: vi.fn(),
  uploadInferenceAudio: vi.fn(),
  deleteInferenceAudio: vi.fn(),
  createSpeechTask: vi.fn(),
  saveSpeechTask: vi.fn(),
  importInferenceAudio: vi.fn(),
}));
const item = {
  id: "qwen3-tts-0.6b-base",
  capability: "speech_synthesis" as const,
  label: "Qwen3-TTS 0.6B Base",
  repository: "mlx-community/test",
  license: "Apache-2.0",
  model_revision: "fixed",
  download_bytes: 2520000000,
  required_disk_bytes: 7200000000,
  compatible: true,
  status: "not_installed",
  enabled: false,
  loaded: false,
  busy: false,
  progress: 0,
  revision: 0,
};
function wrap(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {children}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(localApi.getLocalModels).mockResolvedValue({
    can_manage: true,
    items: [item],
  });
});

test("speech cloning requires uploaded audio and its transcript", async () => {
  vi.mocked(localApi.getInferenceOptions).mockResolvedValue({
    items: [
      {
        id: "m",
        label: "Local",
        modalities: ["speech_synthesis"],
        parameters: {
          speech_synthesis: {
            languages: ["Chinese"],
            max_text_length: 2000,
            max_reference_bytes: 20 * 1024 ** 2,
          },
        },
      },
    ],
  });
  vi.mocked(localApi.getInferenceTasks).mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.mocked(localApi.uploadInferenceAudio).mockResolvedValue({
    id: "reference",
    filename: "voice.wav",
    mime_type: "audio/wav",
    media_kind: "audio",
    byte_size: 100,
  });
  wrap(
    <SpeechSynthesisTestPanel
      models={[
        {
          value: "m",
          label: "Local",
          description: "",
          capabilities: ["speech_synthesis"],
          providerKind: "local_qwen_tts",
        },
      ]}
      modelId="m"
      onSelectMode={vi.fn()}
      onSelectModel={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  const generate = screen.getByRole("button", { name: "生成语音" });
  expect(generate).toBeDisabled();
  await user.type(screen.getByLabelText("目标文字"), "你好");
  await user.type(screen.getByLabelText("录音对应文字"), "参考录音");
  await waitFor(() =>
    expect(screen.getByLabelText("参考录音")).not.toBeDisabled(),
  );
  await user.upload(
    screen.getByLabelText("参考录音"),
    new File(["fixture"], "voice.wav", { type: "audio/wav" }),
  );
  await waitFor(() => expect(generate).not.toBeDisabled());
  await user.click(generate);
  await waitFor(() =>
    expect(localApi.createSpeechTask).toHaveBeenCalledWith(
      "m",
      "你好",
      "Chinese",
      expect.objectContaining({ id: "reference" }),
      "参考录音",
    ),
  );
});

test("speech reference writes require content permission", async () => {
  vi.mocked(localApi.getInferenceOptions).mockResolvedValue({
    items: [
      {
        id: "m",
        label: "Local",
        modalities: ["speech_synthesis"],
        parameters: {},
      },
    ],
  });
  vi.mocked(localApi.getInferenceTasks).mockResolvedValue({
    items: [],
    total: 0,
  });
  wrap(
    <AccountAccessProvider
      userId="test-user"
      permissions={["content.read", "models.use"]}
    >
      <SpeechSynthesisTestPanel
        models={[
          {
            value: "m",
            label: "Local",
            description: "",
            capabilities: ["speech_synthesis"],
            providerKind: "local_qwen_tts",
          },
        ]}
        modelId="m"
        onSelectMode={vi.fn()}
        onSelectModel={vi.fn()}
      />
    </AccountAccessProvider>,
  );
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "上传参考录音" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "从文件库选择" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "生成语音" })).toBeDisabled();
  expect(localApi.uploadInferenceAudio).not.toHaveBeenCalled();
});
