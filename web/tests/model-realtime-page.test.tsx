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
        },
      ],
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

  expect(
    await screen.findByText("免按键全双工 · 自动断句 · 可打断"),
  ).toBeInTheDocument();
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
  expect(screen.getByText(/输入 16 kHz PCM16/)).toBeInTheDocument();
  expect(screen.getByText(/输出 24 kHz PCM16/)).toBeInTheDocument();
  expect(screen.getByText("400 ms 自动断句")).toBeInTheDocument();
  expect(screen.getByText(/结束通话或离开页面后立即清除/)).toBeInTheDocument();
  expect(container.querySelector("select")).toBeNull();
});
