import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimeline,
  VideoEditorTrack,
} from "./types";

export const frameUs = (fps: number) => Math.round(1_000_000 / fps);
export const snapUs = (value: number, fps: number) =>
  Math.max(0, Math.round(value / frameUs(fps)) * frameUs(fps));
export const timelineDuration = (timeline?: VideoEditorTimeline) =>
  Math.max(
    1_000_000,
    ...(timeline?.document.tracks ?? []).flatMap((track) =>
      (track.clips ?? []).map((clip) => clip.timelineStartUs + clip.durationUs),
    ),
  );
export const formatTime = (value: number) => {
  const seconds = Math.max(0, value) / 1_000_000;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(3).padStart(6, "0")}`;
};

const ease = (progress: number, interpolation: string) => {
  const value = Math.max(0, Math.min(1, progress));
  if (interpolation === "ease-in") return value * value;
  if (interpolation === "ease-out") return 1 - (1 - value) ** 2;
  if (interpolation === "ease-in-out") return value * value * (3 - 2 * value);
  return value;
};

export function clipPropertyAt(
  clip: VideoEditorClip,
  property: "x" | "y" | "scaleX" | "scaleY" | "rotation" | "opacity" | "volume",
  localUs: number,
  fallback: number,
) {
  const keys = (clip.keyframes ?? [])
    .filter((keyframe) => keyframe.property === property)
    .sort((left, right) => left.timeUs - right.timeUs);
  if (!keys.length || localUs < keys[0]!.timeUs) return fallback;
  if (localUs >= keys.at(-1)!.timeUs) return keys.at(-1)!.value;
  const rightIndex = keys.findIndex((keyframe) => keyframe.timeUs > localUs);
  const left = keys[rightIndex - 1]!;
  const right = keys[rightIndex]!;
  const progress = ease(
    (localUs - left.timeUs) / Math.max(1, right.timeUs - left.timeUs),
    right.interpolation,
  );
  return left.value + (right.value - left.value) * progress;
}

export function clipOpacityAt(clip: VideoEditorClip, localUs: number) {
  const base = clip.transform?.opacity ?? 1;
  let opacity = clipPropertyAt(clip, "opacity", localUs, base);
  if (clip.transitionIn && clip.transitionIn.durationUs > 0)
    opacity *= Math.min(1, localUs / clip.transitionIn.durationUs);
  if (clip.transitionOut && clip.transitionOut.durationUs > 0)
    opacity *= Math.min(
      1,
      (clip.durationUs - localUs) / clip.transitionOut.durationUs,
    );
  return Math.max(0, Math.min(1, opacity));
}

const baseClip = (
  asset: VideoEditorAsset,
  trackId: string,
  startUs: number,
): VideoEditorClip => ({
  id: crypto.randomUUID(),
  trackId,
  kind: asset.mediaKind as VideoEditorClip["kind"],
  name: asset.displayName,
  timelineStartUs: startUs,
  durationUs: Number(asset.probe?.durationUs || 5_000_000),
  sourceInUs: 0,
  assetId: asset.id,
  fontSize: 72,
  textColor: "#ffffff",
  fitMode: "native",
  flipX: false,
  volume: 1,
  transform: {
    x: 960,
    y: 540,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
  },
  keyframes: [],
});

export function operationsForAsset(
  asset: VideoEditorAsset,
  tracks: VideoEditorTrack[],
  startUs: number,
  preferredTrackId?: string,
): VideoEditorOperation[] {
  const preferred = tracks.find((track) => track.id === preferredTrackId);
  const visual =
    (preferred?.kind === "visual" ? preferred : undefined) ??
    tracks.find((track) => track.kind === "visual");
  const audio =
    (preferred?.kind === "audio" ? preferred : undefined) ??
    tracks.find((track) => track.kind === "audio");
  if (asset.mediaKind === "audio") {
    if (preferred && preferred.kind !== "audio") return [];
    if (!audio) return [];
    return [{ type: "addClip", clip: baseClip(asset, audio.id, startUs) }];
  }
  if (preferred && preferred.kind !== "visual") return [];
  if (!visual) return [];
  const picture = baseClip(asset, visual.id, startUs);
  if (asset.mediaKind !== "video" || !audio) {
    return [{ type: "addClip", clip: picture }];
  }
  const group = crypto.randomUUID();
  picture.linkGroupId = group;
  const sound = {
    ...baseClip(asset, audio.id, startUs),
    id: crypto.randomUUID(),
    kind: "audio" as const,
    linkGroupId: group,
  };
  return [
    { type: "addClip", clip: picture },
    { type: "addClip", clip: sound },
  ];
}

export const newTrack = (
  kind: "visual" | "audio",
  order: number,
): VideoEditorTrack => ({
  id: crypto.randomUUID(),
  kind,
  name: kind === "visual" ? `画面 ${order + 1}` : `音频 ${order + 1}`,
  order,
  locked: false,
  hidden: false,
  muted: false,
  clips: [],
});
