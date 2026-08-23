import {
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_OUTPUT_SAMPLE_RATE,
  base64ToFloat32Pcm,
  createStreamingDownsampler,
  floatToPcm16,
  pcm16ToBase64,
} from "@platform/voice/pcm";

export type MicCapture = {
  stream: MediaStream;
  setMuted: (muted: boolean) => void;
  stop: () => void;
};

export type MicrophoneProcessingSettings = {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
};

export type PlaybackBufferSettings = {
  startBufferMs: number;
  recoveryBufferMs: number;
};

const DEFAULT_MICROPHONE_PROCESSING: MicrophoneProcessingSettings = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const DEFAULT_PLAYBACK_BUFFERING: PlaybackBufferSettings = {
  startBufferMs: 400,
  recoveryBufferMs: 800,
};

export async function createVoiceAudioContext(): Promise<AudioContext> {
  const context = new AudioContext();
  if (context.state === "suspended") await context.resume();
  return context;
}

export async function startMicCapture(
  context: AudioContext,
  onChunk: (chunk: string) => void,
  settings: MicrophoneProcessingSettings = DEFAULT_MICROPHONE_PROCESSING,
): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
      channelCount: 1,
    },
  });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const sink = context.createGain();
  const downsample = createStreamingDownsampler(
    context.sampleRate,
    VOICE_INPUT_SAMPLE_RATE,
  );
  sink.gain.value = 0;
  source.connect(processor);
  processor.connect(sink);
  sink.connect(context.destination);
  processor.onaudioprocess = (event) => {
    const samples = downsample(event.inputBuffer.getChannelData(0));
    if (samples.length) onChunk(pcm16ToBase64(floatToPcm16(samples)));
  };
  return {
    stream,
    setMuted: (muted) => {
      for (const track of stream.getAudioTracks()) track.enabled = !muted;
    },
    stop: () => {
      processor.onaudioprocess = null;
      processor.disconnect();
      sink.disconnect();
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

export type PlaybackReference = {
  samples: Float32Array;
  sampleRate: number;
  startTimeSec: number;
};

/** 24 kHz PCM 播放器：400ms 起播，欠载后重新积攒 800ms。 */
export class RealtimePcmPlayer {
  private generation = 0;
  private nextTime = 0;
  private primed = false;
  private recovering = false;
  private queued: Float32Array[] = [];
  private queuedSamples = 0;
  private nodes = new Set<AudioBufferSourceNode>();
  private gain: GainNode;
  private primeSamples: number;
  private recoverySamples: number;

  constructor(
    private context: AudioContext,
    private onReference?: (reference: PlaybackReference) => void,
    buffering: PlaybackBufferSettings = DEFAULT_PLAYBACK_BUFFERING,
  ) {
    this.gain = context.createGain();
    this.gain.connect(context.destination);
    this.primeSamples = Math.round(
      (VOICE_OUTPUT_SAMPLE_RATE * buffering.startBufferMs) / 1_000,
    );
    this.recoverySamples = Math.round(
      (VOICE_OUTPUT_SAMPLE_RATE * buffering.recoveryBufferMs) / 1_000,
    );
  }

  setMuted(muted: boolean) {
    this.gain.gain.value = muted ? 0 : 1;
  }

  hasActivePlayback() {
    return this.nodes.size > 0 || this.queuedSamples > 0;
  }

  enqueueBase64(input: string) {
    const samples = base64ToFloat32Pcm(input);
    if (!samples.length) return;
    this.queued.push(samples);
    this.queuedSamples += samples.length;
    const threshold = !this.primed
      ? this.primeSamples
      : this.recovering
        ? this.recoverySamples
        : 1;
    if (this.queuedSamples >= threshold) this.flush();
  }

  drain() {
    this.flush(true);
  }

  clear() {
    this.generation += 1;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        // The node may already have ended.
      }
    }
    this.nodes.clear();
    this.queued = [];
    this.queuedSamples = 0;
    this.nextTime = 0;
    this.primed = false;
    this.recovering = false;
  }

  destroy() {
    this.clear();
    this.gain.disconnect();
  }

  private flush(force = false) {
    if (!this.queuedSamples || this.context.state === "closed") return;
    const generation = this.generation;
    const samples = new Float32Array(this.queuedSamples);
    let offset = 0;
    for (const part of this.queued) {
      samples.set(part, offset);
      offset += part.length;
    }
    this.queued = [];
    this.queuedSamples = 0;
    const now = this.context.currentTime;
    if (this.primed && this.nextTime <= now) this.recovering = true;
    if (!force && this.recovering && samples.length < this.recoverySamples) {
      this.queued = [samples];
      this.queuedSamples = samples.length;
      return;
    }
    this.primed = true;
    this.recovering = false;
    if (this.nextTime <= now) this.nextTime = now + 0.08;
    const buffer = this.context.createBuffer(
      1,
      samples.length,
      VOICE_OUTPUT_SAMPLE_RATE,
    );
    buffer.copyToChannel(samples, 0);
    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.gain);
    const startTimeSec = this.nextTime;
    this.nextTime += buffer.duration;
    this.nodes.add(node);
    node.onended = () => this.nodes.delete(node);
    node.start(startTimeSec);
    if (generation === this.generation) {
      this.onReference?.({
        samples: new Float32Array(samples),
        sampleRate: VOICE_OUTPUT_SAMPLE_RATE,
        startTimeSec,
      });
    }
  }
}
