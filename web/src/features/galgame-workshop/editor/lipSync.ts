import type { GalgameStoryCharacter } from "@features/galgame-workshop/api";

export type LipSyncFrame = 0 | 1 | 2;

export type LipSyncPresentation = {
  expressionId: string | null | undefined;
  controlledFrameIndex?: LipSyncFrame;
};

export type AudioLevelMonitor = {
  resume: () => Promise<void>;
  dispose: () => void;
};

const MIN_DECIBELS = -100;

/**
 * 把运行时口型帧映射回同一姿态。缺少差分时始终回退到作者选择的表情。
 */
export function resolveLipSyncExpressionId(
  character: GalgameStoryCharacter,
  authoredExpressionId: string | null | undefined,
  frame: LipSyncFrame,
) {
  if (!authoredExpressionId || frame === 0) return authoredExpressionId;
  const match = /^(.*-f)00[0-2]$/.exec(authoredExpressionId);
  if (!match) return authoredExpressionId;
  const candidateId = `${match[1]}00${frame}`;
  return (character.expressions ?? []).some(
    (expression) => expression.id === candidateId,
  )
    ? candidateId
    : authoredExpressionId;
}

/**
 * 语音口型序列保持作者选择的表情 ID，只受控切换三张口型帧；
 * 旧工程仍可继续使用 f000 / f001 / f002 三条独立表情。
 */
export function resolveLipSyncPresentation(
  character: GalgameStoryCharacter,
  authoredExpressionId: string | null | undefined,
  frame: LipSyncFrame,
): LipSyncPresentation {
  const expression = (character.expressions ?? []).find(
    (candidate) => candidate.id === authoredExpressionId,
  );
  if (
    expression?.renderMode === "frameSequence" &&
    expression.sequence?.playbackMode === "lipSync" &&
    expression.sequence.frames.length === 3
  )
    return {
      expressionId: authoredExpressionId,
      controlledFrameIndex: frame,
    };
  return {
    expressionId: resolveLipSyncExpressionId(
      character,
      authoredExpressionId,
      frame,
    ),
  };
}

/**
 * 使用无对白采样维护动态底噪，并限制口型变化频率，避免三帧快速闪烁。
 */
export class LipSyncLevelTracker {
  private noiseFloorDb = -48;
  private frame: LipSyncFrame = 0;
  private changedAt = 0;

  update(
    levelDb: number,
    speaking: boolean,
    nowMs: number,
    fps = 12,
  ): LipSyncFrame {
    if (!speaking) {
      const sample = Math.max(MIN_DECIBELS, Math.min(-12, levelDb));
      this.noiseFloorDb = this.noiseFloorDb * 0.9 + sample * 0.1;
      this.frame = 0;
      this.changedAt = nowMs;
      return 0;
    }
    const aboveNoise = levelDb - this.noiseFloorDb;
    const target: LipSyncFrame = aboveNoise >= 12 ? 2 : aboveNoise >= 6 ? 1 : 0;
    if (target === this.frame) return this.frame;
    const minimumFrameDurationMs = 1000 / Math.max(1, Math.min(60, fps));
    if (nowMs - this.changedAt < minimumFrameDurationMs) return this.frame;
    this.frame = target;
    this.changedAt = nowMs;
    return this.frame;
  }

  reset() {
    this.noiseFloorDb = -48;
    this.frame = 0;
    this.changedAt = 0;
  }
}

/**
 * 从正在播放的 HTMLAudioElement 读取 RMS。浏览器不支持 Web Audio 时静默降级。
 */
export function createAudioLevelMonitor(
  audio: HTMLAudioElement,
  onLevel: (decibels: number) => void,
): AudioLevelMonitor | undefined {
  if (typeof AudioContext === "undefined") return undefined;
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return undefined;
  }
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.65;
  const samples = new Float32Array(analyser.fftSize);
  let source: MediaElementAudioSourceNode;
  try {
    source = context.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(context.destination);
  } catch {
    void context.close();
    return undefined;
  }
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    onLevel(Math.max(MIN_DECIBELS, 20 * Math.log10(Math.max(rms, 0.00001))));
  }, 83);
  let disposed = false;
  return {
    resume: async () => {
      if (!disposed && context.state === "suspended") await context.resume();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      void context.close();
    },
  };
}
