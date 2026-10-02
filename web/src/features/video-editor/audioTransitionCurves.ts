import type { VideoEditorTimelineTransition } from "./types";

export type AudioTransitionKind = Extract<
  VideoEditorTimelineTransition["kind"],
  "audio-crossfade" | "audio-equal-power" | "audio-dip" | "audio-filter-sweep"
>;

export const audioTransitionKinds: AudioTransitionKind[] = [
  "audio-crossfade",
  "audio-equal-power",
  "audio-dip",
  "audio-filter-sweep",
];

export const audioTransitionLabels: Record<AudioTransitionKind, string> = {
  "audio-crossfade": "交叉淡化",
  "audio-equal-power": "等功率交叉淡化",
  "audio-dip": "淡出再淡入",
  "audio-filter-sweep": "频率扫掠",
};

export function audioTransitionProgress(progress: number, easing: string) {
  const value = Math.max(0, Math.min(1, progress));
  if (easing === "ease-in") return value * value;
  if (easing === "ease-out") return 1 - (1 - value) ** 2;
  if (easing === "ease-in-out") return value * value * (3 - 2 * value);
  return value;
}

export function audioTransitionGain(
  kind: AudioTransitionKind,
  progress: number,
  incoming: boolean,
) {
  const value = Math.max(0, Math.min(1, progress));
  if (kind === "audio-equal-power")
    return incoming
      ? Math.sin((Math.PI * value) / 2)
      : Math.cos((Math.PI * value) / 2);
  if (kind === "audio-dip")
    return incoming ? Math.max(0, 2 * value - 1) : Math.max(0, 1 - 2 * value);
  return incoming ? value : 1 - value;
}

export function audioSweepFrequency(progress: number, incoming: boolean) {
  const value = Math.max(0, Math.min(1, progress));
  const start = incoming ? 3000 : 18000;
  const end = incoming ? 30 : 300;
  return start * (end / start) ** value;
}
