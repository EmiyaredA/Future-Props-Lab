import { resampleLinear } from "@platform/voice/pcm";
import type { PlaybackReference } from "@platform/voice/audioRuntime";
import type { VadFrame } from "@platform/voice/vad";

const RATE = 16_000;

function fit(mic: Float32Array, reference: Float32Array) {
  const length = Math.min(mic.length, reference.length);
  if (length < 64) return { correlation: 0, residual: 1 };
  let dot = 0;
  let micEnergy = 0;
  let referenceEnergy = 0;
  for (let index = 0; index < length; index += 1) {
    dot += mic[index] * reference[index];
    micEnergy += mic[index] * mic[index];
    referenceEnergy += reference[index] * reference[index];
  }
  if (micEnergy < 1e-9 || referenceEnergy < 1e-9) {
    return { correlation: 0, residual: 1 };
  }
  const scale = dot / referenceEnergy;
  let residualEnergy = 0;
  for (let index = 0; index < length; index += 1) {
    const residual = mic[index] - scale * reference[index];
    residualEnergy += residual * residual;
  }
  return {
    correlation: Math.abs(dot) / Math.sqrt(micEnergy * referenceEnergy),
    residual: Math.sqrt(residualEnergy / micEnergy),
  };
}

/** 使用已排程扬声器 PCM 作为回声参考，避免把模型自己的声音误判为用户插话。 */
export class EchoAwareBargeInDetector {
  private references: Array<PlaybackReference & { endTimeSec: number }> = [];
  private speechMs = 0;
  private turnId: string | null = null;
  private interrupted = false;

  constructor(private onBargeIn: (turnId: string) => void) {}

  setPlaybackTurn(turnId: string | null) {
    if (this.turnId !== turnId) {
      this.turnId = turnId;
      this.speechMs = 0;
      this.interrupted = false;
    }
  }

  addReference(reference: PlaybackReference) {
    this.references.push({
      ...reference,
      endTimeSec:
        reference.startTimeSec +
        reference.samples.length / reference.sampleRate,
    });
  }

  process(frame: VadFrame, playing: boolean) {
    if (!playing || !this.turnId || this.interrupted) {
      this.speechMs = 0;
      return;
    }
    this.references = this.references.filter(
      (reference) => reference.endTimeSec >= frame.audioTimeSec - 2,
    );
    const mic = resampleLinear(frame.samples, RATE, RATE);
    const durationMs = (mic.length / RATE) * 1_000;
    const start = frame.audioTimeSec - mic.length / RATE;
    const reference = new Float32Array(mic.length);
    for (const segment of this.references) {
      for (let index = 0; index < reference.length; index += 1) {
        const time = start + index / RATE;
        if (time < segment.startTimeSec || time >= segment.endTimeSec) continue;
        const sourceIndex = Math.min(
          segment.samples.length - 1,
          Math.floor((time - segment.startTimeSec) * segment.sampleRate),
        );
        reference[index] += segment.samples[sourceIndex];
      }
    }
    const echo = fit(mic, reference);
    const nearSpeech =
      frame.probability >= 0.55 &&
      (echo.correlation < 0.62 || echo.residual > 0.58);
    this.speechMs = nearSpeech ? this.speechMs + durationMs : 0;
    if (this.speechMs >= 192) {
      this.interrupted = true;
      this.onBargeIn(this.turnId);
    }
  }

  reset() {
    this.references = [];
    this.speechMs = 0;
    this.turnId = null;
    this.interrupted = false;
  }
}
