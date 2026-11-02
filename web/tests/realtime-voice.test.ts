import { describe, expect, test, vi } from "vitest";
import { RealtimePcmPlayer } from "@platform/voice/audioRuntime";
import { EchoAwareBargeInDetector } from "@platform/voice/echoBargeIn";
import {
  base64ToFloat32Pcm,
  createStreamingDownsampler,
  floatToPcm16,
  pcm16ToBase64,
} from "@platform/voice/pcm";
import { createVoiceVad } from "@platform/voice/vad";
import { VadEndpointCommitter } from "@platform/voice/vadEndpoint";
import {
  initialRealtimeVoiceState,
  realtimeVoiceReducer,
} from "@features/models/realtime/realtimeVoiceState";

type OrtConfigTarget = {
  env: {
    logLevel: string;
    wasm: {
      numThreads: number;
      proxy: boolean;
      wasmPaths: unknown;
    };
  };
};

const micVadNew = vi.hoisted(() =>
  vi.fn(async (options: { ortConfig: (ort: OrtConfigTarget) => void }) => {
    void options;
    return { destroy: vi.fn(async () => undefined) };
  }),
);

vi.mock("@ricky0123/vad-web", () => ({
  MicVAD: { new: micVadNew },
}));

describe("realtime voice PCM", () => {
  test("encodes PCM16 and continuously downsamples across chunk boundaries", () => {
    const samples = Float32Array.from([-1, -0.25, 0, 0.25, 1]);
    const decoded = base64ToFloat32Pcm(pcm16ToBase64(floatToPcm16(samples)));
    expect([...decoded]).toEqual(
      expect.arrayContaining([
        expect.closeTo(-1, 4),
        expect.closeTo(-0.25, 3),
        0,
        expect.closeTo(0.25, 3),
        expect.closeTo(1, 4),
      ]),
    );

    const downsample = createStreamingDownsampler(48_000, 16_000);
    const first = downsample(new Float32Array(1_001).fill(0.5));
    const second = downsample(new Float32Array(999).fill(0.5));
    expect(first.length + second.length).toBe(666);
    expect(second.at(-1)).toBeCloseTo(0.5, 4);
  });

  test("primes playback before scheduling and flushes a short final tail", () => {
    const starts: number[] = [];
    const stops = vi.fn();
    const context = {
      state: "running",
      currentTime: 1,
      destination: {},
      createGain: () => ({
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createBuffer: (_channels: number, length: number, rate: number) => ({
        duration: length / rate,
        copyToChannel: vi.fn(),
      }),
      createBufferSource: () => ({
        buffer: null,
        connect: vi.fn(),
        start: (time: number) => starts.push(time),
        stop: stops,
        onended: null,
      }),
    } as unknown as AudioContext;
    const player = new RealtimePcmPlayer(context);
    const short = pcm16ToBase64(new Int16Array(4_800));
    player.enqueueBase64(short);
    expect(starts).toHaveLength(0);
    player.enqueueBase64(short);
    expect(starts).toHaveLength(1);
    Object.assign(context, { currentTime: 2 });
    player.enqueueBase64(pcm16ToBase64(new Int16Array(1_000)));
    expect(starts).toHaveLength(1);
    player.drain();
    expect(starts).toHaveLength(2);
    player.clear();
    expect(stops).toHaveBeenCalled();
  });
});

test("VAD uses the bundled runtime module with a self-hosted WASM binary", async () => {
  await createVoiceVad({
    context: { currentTime: 0 } as AudioContext,
    stream: {} as MediaStream,
    onFrame: vi.fn(),
    onSpeechStart: vi.fn(),
    onSpeechEnd: vi.fn(),
  });

  const vadOptions = micVadNew.mock.calls[0]?.[0];
  const ort = {
    env: {
      logLevel: "warning",
      wasm: {
        numThreads: 0,
        proxy: true,
        wasmPaths: "/voice-vad/",
      },
    },
  };
  vadOptions?.ortConfig(ort);

  expect(ort.env.wasm).toMatchObject({
    numThreads: 1,
    proxy: false,
    wasmPaths: {
      mjs: expect.stringMatching(/ort-wasm-simd-threaded\.mjs/),
      wasm: expect.stringMatching(/\/voice-vad\/ort-wasm-simd-threaded\.wasm$/),
    },
  });
});

test("VAD endpoint commits once even when speech.started arrives late", () => {
  const commits: string[] = [];
  const endpoint = new VadEndpointCommitter((turnId) => commits.push(turnId));
  endpoint.speechEnded();
  endpoint.userSpeechStarted("turn-a");
  endpoint.speechEnded();
  expect(commits).toEqual(["turn-a"]);
  endpoint.finishTurn();
  endpoint.userSpeechStarted("turn-b");
  endpoint.speechEnded();
  expect(commits).toEqual(["turn-a", "turn-b"]);
});

test("echo-aware barge-in ignores playback echo and accepts near-end speech", () => {
  const interrupted = vi.fn();
  const detector = new EchoAwareBargeInDetector(interrupted);
  const reference = Float32Array.from(
    { length: 16_000 },
    (_value, index) => Math.sin((index / 16_000) * Math.PI * 440) * 0.2,
  );
  detector.setPlaybackTurn("assistant-turn");
  detector.addReference({
    samples: reference,
    sampleRate: 16_000,
    startTimeSec: 0,
  });
  for (let index = 0; index < 8; index += 1) {
    detector.process(
      {
        probability: 0.95,
        samples: reference.slice(index * 512, (index + 1) * 512),
        audioTimeSec: ((index + 1) * 512) / 16_000,
      },
      true,
    );
  }
  expect(interrupted).not.toHaveBeenCalled();
  for (let index = 0; index < 7; index += 1) {
    detector.process(
      {
        probability: 0.95,
        samples: new Float32Array(512).fill(index % 2 ? 0.2 : -0.17),
        audioTimeSec: 0.3 + ((index + 1) * 512) / 16_000,
      },
      true,
    );
  }
  expect(interrupted).toHaveBeenCalledOnce();
  expect(interrupted).toHaveBeenCalledWith("assistant-turn");
});

test("realtime reducer tracks streaming state and retains results on end", () => {
  let state = realtimeVoiceReducer(initialRealtimeVoiceState, {
    type: "server",
    event: { type: "call_started" },
    now: 1_000,
  });
  state = realtimeVoiceReducer(state, {
    type: "server",
    event: { type: "user_speech_started", turn_id: "u1" },
    now: 1_200,
  });
  state = realtimeVoiceReducer(state, {
    type: "server",
    event: { type: "user_transcript", text: "你好" },
    now: 1_300,
  });
  state = realtimeVoiceReducer(state, {
    type: "server",
    event: { type: "audio", turn_id: "u1" },
    now: 1_450,
  });
  expect(state.status).toBe("speaking");
  expect(state.firstAudioLatencyMs).toBe(250);
  state = realtimeVoiceReducer(state, {
    type: "server",
    event: { type: "call_ended" },
    now: 2_000,
  });
  expect(state.status).toBe("ended");
  expect(state.userTranscript).toBe("你好");
  expect(state.assistantTranscript).toBe("");
  expect(state.turns).toEqual([
    {
      turnId: "u1",
      userTranscript: "你好",
      assistantTranscript: "",
    },
  ]);
});

test("realtime reducer replaces cumulative user hypotheses without duplicating text", () => {
  let state = realtimeVoiceReducer(initialRealtimeVoiceState, {
    type: "server",
    event: { type: "user_speech_started", turn_id: "u1" },
    now: 1_000,
  });
  for (const text of ["你", "你现在", "你现在具体", "你现在具体有哪些内容"]) {
    state = realtimeVoiceReducer(state, {
      type: "server",
      event: { type: "user_transcript_delta", turn_id: "u1", text },
      now: 1_100,
    });
  }
  expect(state.userTranscript).toBe("你现在具体有哪些内容");

  state = realtimeVoiceReducer(state, {
    type: "server",
    event: { type: "user_transcript_delta", turn_id: "u1", text: "" },
    now: 1_150,
  });
  expect(state.userTranscript).toBe("你现在具体有哪些内容");

  state = realtimeVoiceReducer(state, {
    type: "server",
    event: {
      type: "user_transcript_delta",
      turn_id: "u1",
      text: "你现在想了解哪些内容",
    },
    now: 1_200,
  });
  expect(state.userTranscript).toBe("你现在想了解哪些内容");

  state = realtimeVoiceReducer(state, {
    type: "server",
    event: {
      type: "assistant_transcript_delta",
      turn_id: "u1",
      text: "可以",
    },
    now: 1_300,
  });
  state = realtimeVoiceReducer(state, {
    type: "server",
    event: {
      type: "assistant_transcript_delta",
      turn_id: "u1",
      text: "帮你",
    },
    now: 1_400,
  });
  expect(state.assistantTranscript).toBe("可以帮你");
  expect(state.turns).toEqual([
    {
      turnId: "u1",
      userTranscript: "你现在想了解哪些内容",
      assistantTranscript: "可以帮你",
    },
  ]);

  state = realtimeVoiceReducer(state, {
    type: "server",
    event: { type: "turn_done", turn_id: "u1" },
    now: 1_500,
  });
  state = realtimeVoiceReducer(state, {
    type: "server",
    event: { type: "user_speech_started", turn_id: "u2" },
    now: 2_000,
  });
  state = realtimeVoiceReducer(state, {
    type: "server",
    event: { type: "user_transcript", turn_id: "u2", text: "第二个问题" },
    now: 2_100,
  });
  state = realtimeVoiceReducer(state, {
    type: "server",
    event: {
      type: "assistant_transcript_done",
      turn_id: "u2",
      text: "第二个回答",
    },
    now: 2_200,
  });
  expect(state.turns).toEqual([
    {
      turnId: "u1",
      userTranscript: "你现在想了解哪些内容",
      assistantTranscript: "可以帮你",
    },
    {
      turnId: "u2",
      userTranscript: "第二个问题",
      assistantTranscript: "第二个回答",
    },
  ]);
});
