import type { SequenceClip } from "./types";

/** Resource distance boundaries, not joints or inferred painted contacts. */
export function validDistanceStages(clip: SequenceClip): boolean {
  const points = clip.distanceAtFrame;
  return (
    points === undefined ||
    (clip.loop &&
      clip.distancePerCycle !== undefined &&
      Number.isFinite(clip.distancePerCycle) &&
      clip.distancePerCycle > 0 &&
      Array.isArray(points) &&
      points.length === clip.frames.length + 1 &&
      points[0] === 0 &&
      points[points.length - 1] === clip.distancePerCycle &&
      Array.from(points).every(
        (n, i) =>
          Object.hasOwn(points, i) &&
          Number.isFinite(n) &&
          n >= 0 &&
          n <= clip.distancePerCycle! &&
          (i === 0 || n >= points[i - 1]),
      ))
  );
}

export type DistanceStage = {
  index: number;
  cycle: number;
  phaseOrigin: number | null;
  enteredAt: number | null;
  lastDistance: number;
};
export type DistanceStageSample = {
  state: DistanceStage;
  index: number;
  referenceDistance: number;
  remaining: number;
  progress: number;
};

/** One installed cel boundary per call; neither a long clock nor phase skips a hold. */
export function sampleDistanceStage(
  clip: SequenceClip,
  previous: DistanceStage | undefined,
  t: number,
  phase: number,
): DistanceStageSample | null {
  const points = clip.distanceAtFrame!;
  const stride = clip.distancePerCycle!;
  const state: DistanceStage = previous
    ? { ...previous }
    : {
        index: 0,
        cycle: 0,
        phaseOrigin: null,
        enteredAt: null,
        lastDistance: 0,
      };
  state.phaseOrigin ??= phase - (state.lastDistance / stride) * Math.PI * 2;
  state.enteredAt ??= t;
  const distance = ((phase - state.phaseOrigin) / (Math.PI * 2)) * stride;
  const start = () => state.cycle * stride + points[state.index];
  const end = () => state.cycle * stride + points[state.index + 1];
  if (
    !Number.isFinite(distance) ||
    distance < state.lastDistance - 1e-7 ||
    distance > end() + 1e-7 ||
    t < state.enteredAt
  )
    return null;
  const stationary = end() === start();
  if (
    previous &&
    (stationary
      ? (t - state.enteredAt) * 1000 >= clip.frames[state.index].durationMs
      : distance >= end() - 1e-7)
  ) {
    state.index++;
    if (state.index === clip.frames.length) {
      state.index = 0;
      state.cycle++;
    }
    state.enteredAt = t;
  }
  state.lastDistance = distance;
  const hold = end() === start();
  return {
    state,
    index: state.index,
    referenceDistance: start(),
    remaining: Math.max(0, end() - distance),
    progress: hold
      ? Math.min(
          0.999999999,
          ((t - state.enteredAt) * 1000) / clip.frames[state.index].durationMs,
        )
      : 1,
  };
}
