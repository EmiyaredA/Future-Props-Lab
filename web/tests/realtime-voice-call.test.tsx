import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const voiceMocks = vi.hoisted(() => ({
  createContext: vi.fn(),
  startCapture: vi.fn(),
  captureStop: vi.fn(),
  captureMuted: vi.fn(),
  vadDestroy: vi.fn(),
  vadOptions: null as null | {
    onSpeechEnd: () => void;
  },
  playerEnqueue: vi.fn(),
  playerClear: vi.fn(),
  playerDrain: vi.fn(),
  playerDestroy: vi.fn(),
  playerMuted: vi.fn(),
  detectorTurn: vi.fn(),
  detectorReset: vi.fn(),
  micChunk: null as null | ((data: string) => void),
}));

vi.mock("@platform/voice/audioRuntime", () => ({
  createVoiceAudioContext: voiceMocks.createContext,
  startMicCapture: voiceMocks.startCapture,
  RealtimePcmPlayer: class {
    enqueueBase64 = voiceMocks.playerEnqueue;
    clear = voiceMocks.playerClear;
    drain = voiceMocks.playerDrain;
    destroy = voiceMocks.playerDestroy;
    setMuted = voiceMocks.playerMuted;
    hasActivePlayback = () => true;
  },
}));

vi.mock("@platform/voice/vad", () => ({
  createVoiceVad: vi.fn(async (options) => {
    voiceMocks.vadOptions = options;
    return { destroy: voiceMocks.vadDestroy };
  }),
}));

vi.mock("@platform/voice/echoBargeIn", () => ({
  EchoAwareBargeInDetector: class {
    addReference = vi.fn();
    process = vi.fn();
    reset = voiceMocks.detectorReset;
    setPlaybackTurn = voiceMocks.detectorTurn;
  },
}));

import { useRealtimeVoiceCall } from "@features/models/realtime/useRealtimeVoiceCall";

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: Array<Record<string, unknown>> = [];

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send(value: string) {
    this.sent.push(JSON.parse(value) as Record<string, unknown>);
  }

  close(code = 1000) {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code }));
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  message(event: Record<string, unknown>) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(event) }),
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeWebSocket.instances = [];
  voiceMocks.vadOptions = null;
  voiceMocks.micChunk = null;
  const context = {
    state: "running",
    close: vi.fn(async () => undefined),
  } as unknown as AudioContext;
  voiceMocks.createContext.mockResolvedValue(context);
  voiceMocks.startCapture.mockImplementation(
    async (_context: AudioContext, onChunk: (data: string) => void) => {
      voiceMocks.micChunk = onChunk;
      return {
        stream: {} as MediaStream,
        setMuted: voiceMocks.captureMuted,
        stop: voiceMocks.captureStop,
      };
    },
  );
  voiceMocks.vadDestroy.mockResolvedValue(undefined);
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: FakeWebSocket,
  });
});

test("realtime call starts, commits VAD endpoint, streams audio and cleans up", async () => {
  const { result, unmount } = renderHook(() => useRealtimeVoiceCall());
  await act(async () => {
    await result.current.start({
      modelId: "voice-model",
      voice: "f_m_0009_a",
      instructions: "简洁回答",
    });
  });
  const socket = FakeWebSocket.instances[0];
  expect(socket.url).toContain("/v1/model-test/realtime");

  act(() => socket.open());
  expect(socket.sent[0]).toEqual({
    type: "start",
    model_id: "voice-model",
    voice: "f_m_0009_a",
    instructions: "简洁回答",
  });
  act(() => socket.message({ type: "call_started" }));
  await waitFor(() => expect(result.current.state.status).toBe("connected"));

  act(() => {
    socket.message({ type: "user_speech_started", turn_id: "turn-1" });
    voiceMocks.vadOptions?.onSpeechEnd();
    voiceMocks.micChunk?.("mic-pcm");
    socket.message({ type: "audio", turn_id: "turn-1", data: "speaker-pcm" });
  });
  expect(socket.sent).toContainEqual({
    type: "commit_input",
    turn_id: "turn-1",
  });
  expect(socket.sent).toContainEqual({ type: "audio", data: "mic-pcm" });
  expect(voiceMocks.playerEnqueue).toHaveBeenCalledWith("speaker-pcm");

  await act(async () => result.current.stop());
  expect(socket.sent).toContainEqual({ type: "stop" });
  expect(voiceMocks.captureStop).toHaveBeenCalledOnce();
  expect(voiceMocks.vadDestroy).toHaveBeenCalledOnce();
  expect(voiceMocks.playerDestroy).toHaveBeenCalledOnce();
  expect(result.current.state.userTranscript).toBe("");
  expect(result.current.state.assistantTranscript).toBe("");
  unmount();
});
