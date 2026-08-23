import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ModelRealtimeVoiceTestPanel } from "@features/models/realtime/ModelRealtimeVoiceTestPanel";

vi.mock("@features/models/api", async () => {
  const actual = await vi.importActual<typeof import("@features/models/api")>(
    "@features/models/api",
  );
  return {
    ...actual,
    getRealtimeVoiceOptions: vi.fn().mockResolvedValue({
      models: [
        {
          id: "m-realtime",
          provider_id: "p-realtime",
          provider_name: "SenseAudio 实时语音",
          provider_kind: "senseaudio_realtime",
          slug: "senseaudio-realtime-1.0",
          label: "SenseAudio Realtime",
          voices: [
            { value: "f_m_0009_a", label: "气质学姐 · 开心" },
            { value: "m_y_0034_e", label: "可靠青叔 · 主题升华" },
          ],
          default_voice: "f_m_0009_a",
          input_sample_rate: 16_000,
          output_sample_rate: 24_000,
          commit_silence_ms: 400,
          supports_interruption: true,
          supports_tools: true,
          instructions_max_chars: 20_000,
          greeting_max_chars: 2_000,
          input_format: "pcm_s16le",
          output_format: "pcm_s16le",
          channels: 1,
          client_vad: {
            positive_speech_threshold: {
              default: 0.55,
              minimum: 0.05,
              maximum: 1,
              step: 0.01,
            },
            negative_speech_threshold: {
              default: 0.38,
              minimum: 0,
              maximum: 0.95,
              step: 0.01,
            },
            min_speech_ms: {
              default: 320,
              minimum: 64,
              maximum: 5_000,
              step: 32,
            },
            pre_speech_pad_ms: {
              default: 160,
              minimum: 0,
              maximum: 2_000,
              step: 32,
            },
            commit_silence_ms: {
              default: 400,
              minimum: 100,
              maximum: 5_000,
              step: 50,
            },
          },
          playback: {
            start_buffer_ms: {
              default: 400,
              minimum: 0,
              maximum: 2_000,
              step: 50,
            },
            recovery_buffer_ms: {
              default: 800,
              minimum: 0,
              maximum: 3_000,
              step: 50,
            },
          },
          microphone: {
            echo_cancellation: true,
            noise_suppression: true,
            auto_gain_control: true,
          },
        },
      ],
    }),
    getModelTestTools: vi.fn().mockResolvedValue({
      revision: 0,
      overview: {
        total_tools: 0,
        enabled_tools: 0,
        today_runs: 0,
        success_rate: null,
      },
      items: [],
    }),
  };
});

test("renders the hands-free realtime voice workspace without native selects", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <ModelRealtimeVoiceTestPanel
        models={[
          {
            value: "m-realtime",
            label: "SenseAudio Realtime",
            description: "双工实时语音",
            capabilities: ["voice", "end_to_end_speech"],
            providerKind: "senseaudio_realtime",
          },
        ]}
        modelId="m-realtime"
        onSelectMode={vi.fn()}
        onSelectModel={vi.fn()}
      />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("实时语音会话")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "实时语音" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "实时语音音色" }),
    ).toHaveTextContent("气质学姐 · 开心"),
  );
  expect(screen.getByRole("button", { name: "开始通话" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "选择测试工具" })).toBeEnabled();
  expect(screen.getByText(/输入 16 kHz pcm_s16le/)).toBeInTheDocument();
  expect(screen.getByText(/输出 24 kHz pcm_s16le/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /开场白/ })).toBeInTheDocument();
  expect(screen.getByLabelText("开口阈值")).toHaveValue(0.55);
  expect(screen.getByLabelText("静音断句")).toHaveValue(400);
  expect(screen.getByLabelText("起播缓冲")).toHaveValue(400);
  expect(screen.getByRole("switch", { name: "说话打断" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(screen.getByText(/工具调用详情会写入测试记录/)).toBeInTheDocument();
  expect(container.querySelector("select")).toBeNull();
});
