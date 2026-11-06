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
    settings?: {
      positiveSpeechThreshold: number;
      negativeSpeechThreshold: number;
      minSpeechMs: number;
      preSpeechPadMs: number;
      commitSilenceMs: number;
    };
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
import { clearRetainedRealtimeVoiceState } from "@features/models/realtime/realtimeVoiceMemory";

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
  clearRetainedRealtimeVoiceState();
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
      greeting: "你好",
      vad: {
        positiveSpeechThreshold: 0.6,
        negativeSpeechThreshold: 0.3,
        minSpeechMs: 352,
        preSpeechPadMs: 192,
        commitSilenceMs: 500,
      },
      microphone: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
      },
      playback: { startBufferMs: 300, recoveryBufferMs: 900 },
      interruptionEnabled: false,
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
    greeting: "你好",
    client_vad: {
      positive_speech_threshold: 0.6,
      negative_speech_threshold: 0.3,
      min_speech_ms: 352,
      pre_speech_pad_ms: 192,
      commit_silence_ms: 500,
    },
    microphone: {
      echo_cancellation: true,
      noise_suppression: false,
      auto_gain_control: true,
    },
    playback: { start_buffer_ms: 300, recovery_buffer_ms: 900 },
    interruption_enabled: false,
  });
  expect(voiceMocks.startCapture).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(Function),
    {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    },
  );
  expect(voiceMocks.vadOptions?.settings).toEqual({
    positiveSpeechThreshold: 0.6,
    negativeSpeechThreshold: 0.3,
    minSpeechMs: 352,
    preSpeechPadMs: 192,
    commitSilenceMs: 500,
  });
  act(() => socket.message({ type: "call_started" }));
  await waitFor(() => expect(result.current.state.status).toBe("connected"));

  act(() => {
    voiceMocks.micChunk?.("mic-pre-roll");
    socket.message({ type: "user_speech_started", turn_id: "turn-1" });
    socket.message({
      type: "user_transcript_delta",
      turn_id: "turn-1",
      text: "你",
    });
    socket.message({
      type: "user_transcript_delta",
      turn_id: "turn-1",
      text: "你现在",
    });
    socket.message({
      type: "user_transcript_delta",
      turn_id: "turn-1",
      text: "你现在具体有哪些内容",
    });
    voiceMocks.micChunk?.("mic-pcm");
    voiceMocks.vadOptions?.onSpeechEnd();
    socket.message({ type: "audio", turn_id: "turn-1", data: "speaker-pcm" });
  });
  expect(result.current.state.userTranscript).toBe("你现在具体有哪些内容");
  expect(socket.sent).toContainEqual({
    type: "commit_input",
    turn_id: "turn-1",
  });
  expect(socket.sent).toContainEqual({ type: "audio", data: "mic-pcm" });
  expect(voiceMocks.playerEnqueue).toHaveBeenCalledWith("speaker-pcm");

  act(() => {
    socket.message({
      type: "assistant_transcript_done",
      turn_id: "turn-1",
      text: "第一个回答",
    });
    socket.message({ type: "turn_done", turn_id: "turn-1" });
    socket.message({ type: "user_speech_started", turn_id: "turn-2" });
    socket.message({
      type: "user_transcript",
      turn_id: "turn-2",
      text: "第二个问题",
    });
    socket.message({
      type: "assistant_transcript_done",
      turn_id: "turn-2",
      text: "第二个回答",
    });
  });
  expect(result.current.state.turns).toEqual([
    {
      turnId: "turn-1",
      userTranscript: "你现在具体有哪些内容",
      assistantTranscript: "第一个回答",
    },
    {
      turnId: "turn-2",
      userTranscript: "第二个问题",
      assistantTranscript: "第二个回答",
    },
  ]);

  await act(async () => result.current.stop());
  expect(socket.sent).toContainEqual({ type: "stop" });
  expect(voiceMocks.captureStop).toHaveBeenCalledOnce();
  expect(voiceMocks.vadDestroy).toHaveBeenCalledOnce();
  expect(voiceMocks.playerDestroy).toHaveBeenCalledOnce();
  expect(result.current.state.status).toBe("ended");
  expect(result.current.state.userTranscript).toBe("第二个问题");
  expect(result.current.state.assistantTranscript).toBe("第二个回答");
  expect(result.current.state.turns).toHaveLength(2);
  expect(result.current.getTurnAudioInfo("turn-1")).toMatchObject({
    hasUserAudio: true,
    hasAssistantAudio: true,
  });
  unmount();

  const restored = renderHook(() => useRealtimeVoiceCall());
  expect(restored.result.current.state.status).toBe("ended");
  expect(restored.result.current.state.turns).toEqual([
    {
      turnId: "turn-1",
      userTranscript: "你现在具体有哪些内容",
      assistantTranscript: "第一个回答",
    },
    {
      turnId: "turn-2",
      userTranscript: "第二个问题",
      assistantTranscript: "第二个回答",
    },
  ]);
  expect(restored.result.current.getTurnAudioInfo("turn-1")).toMatchObject({
    hasUserAudio: true,
    hasAssistantAudio: true,
  });

  await act(async () => {
    await restored.result.current.replayTurnAudio("turn-1", "user");
  });
  expect(voiceMocks.playerEnqueue).toHaveBeenCalledWith("mic-pre-roll");
  expect(voiceMocks.playerEnqueue).toHaveBeenCalledWith("mic-pcm");
  expect(restored.result.current.replayingAudio).toBe("turn-1:user");
  await act(async () => {
    await restored.result.current.replayTurnAudio("turn-1", "assistant");
  });
  expect(voiceMocks.playerEnqueue).toHaveBeenCalledWith("speaker-pcm");
  expect(restored.result.current.replayingAudio).toBe("turn-1:assistant");

  await act(async () => {
    await restored.result.current.start({
      modelId: "voice-model",
      voice: "f_m_0009_a",
      instructions: "新测试",
      greeting: "",
      vad: {
        positiveSpeechThreshold: 0.55,
        negativeSpeechThreshold: 0.38,
        minSpeechMs: 320,
        preSpeechPadMs: 160,
        commitSilenceMs: 400,
      },
      microphone: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      playback: { startBufferMs: 400, recoveryBufferMs: 800 },
      interruptionEnabled: true,
    });
  });
  expect(restored.result.current.state.turns).toEqual([]);
  expect(restored.result.current.getTurnAudioInfo("turn-1")).toMatchObject({
    hasUserAudio: false,
    hasAssistantAudio: false,
  });
  restored.unmount();
});

test("page close clears retained realtime transcripts", async () => {
  const first = renderHook(() => useRealtimeVoiceCall());
  await act(async () => {
    await first.result.current.start({
      modelId: "voice-model",
      voice: "f_m_0009_a",
      instructions: "简洁回答",
      greeting: "",
      vad: {
        positiveSpeechThreshold: 0.55,
        negativeSpeechThreshold: 0.38,
        minSpeechMs: 320,
        preSpeechPadMs: 160,
        commitSilenceMs: 400,
      },
      microphone: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      playback: { startBufferMs: 400, recoveryBufferMs: 800 },
      interruptionEnabled: true,
    });
  });
  const socket = FakeWebSocket.instances[0];
  act(() => {
    socket.open();
    socket.message({ type: "call_started" });
    socket.message({ type: "user_speech_started", turn_id: "turn-close" });
    voiceMocks.micChunk?.("close-user-pcm");
    socket.message({
      type: "user_transcript",
      turn_id: "turn-close",
      text: "关闭前的内容",
    });
    socket.message({
      type: "audio",
      turn_id: "turn-close",
      data: "close-assistant-pcm",
    });
    window.dispatchEvent(new Event("pagehide"));
  });
  first.unmount();

  const restored = renderHook(() => useRealtimeVoiceCall());
  expect(restored.result.current.state.status).toBe("idle");
  expect(restored.result.current.state.turns).toEqual([]);
  expect(restored.result.current.getTurnAudioInfo("turn-close")).toMatchObject({
    hasUserAudio: false,
    hasAssistantAudio: false,
  });
  restored.unmount();
});
