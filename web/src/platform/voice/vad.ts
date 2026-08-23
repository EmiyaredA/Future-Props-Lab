import { MicVAD } from "@ricky0123/vad-web";

export type VadFrame = {
  probability: number;
  samples: Float32Array;
  audioTimeSec: number;
};

export type VoiceVad = { destroy: () => Promise<void> };

export type VoiceVadSettings = {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  minSpeechMs: number;
  preSpeechPadMs: number;
  commitSilenceMs: number;
};

const DEFAULT_VAD_SETTINGS: VoiceVadSettings = {
  positiveSpeechThreshold: 0.55,
  negativeSpeechThreshold: 0.38,
  minSpeechMs: 320,
  preSpeechPadMs: 160,
  commitSilenceMs: 400,
};

export async function createVoiceVad(options: {
  context: AudioContext;
  stream: MediaStream;
  onFrame: (frame: VadFrame) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  settings?: VoiceVadSettings;
}): Promise<VoiceVad> {
  const assetBase = `${import.meta.env.BASE_URL || "/"}voice-vad/`;
  const settings = options.settings ?? DEFAULT_VAD_SETTINGS;
  const wasmUrl = new URL(
    "ort-wasm-simd-threaded.wasm",
    new URL(assetBase, window.location.origin),
  ).href;
  const vad = await MicVAD.new({
    model: "v5",
    audioContext: options.context,
    baseAssetPath: assetBase,
    onnxWASMBasePath: assetBase,
    getStream: async () => options.stream,
    pauseStream: async () => undefined,
    resumeStream: async () => options.stream,
    processorType: "auto",
    positiveSpeechThreshold: settings.positiveSpeechThreshold,
    negativeSpeechThreshold: settings.negativeSpeechThreshold,
    minSpeechMs: settings.minSpeechMs,
    redemptionMs: settings.commitSilenceMs,
    preSpeechPadMs: settings.preSpeechPadMs,
    submitUserSpeechOnPause: false,
    startOnLoad: true,
    ortConfig: (ort) => {
      ort.env.logLevel = "error";
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      // Keep the Emscripten module bundled by onnxruntime-web. Supplying only
      // the binary override avoids Vite treating a public .mjs file as source.
      ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    },
    onFrameProcessed: (probabilities, frame) =>
      options.onFrame({
        probability: probabilities.isSpeech,
        samples: new Float32Array(frame),
        audioTimeSec: options.context.currentTime,
      }),
    onSpeechStart: () => undefined,
    onSpeechRealStart: options.onSpeechStart,
    onSpeechEnd: options.onSpeechEnd,
    onVADMisfire: () => undefined,
  });
  return { destroy: () => vad.destroy() };
}
