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
      (track.clips ?? []).map(
        (clip) => clip.timelineStartUs + clip.durationUs,
      ),
    ),
  );
export const formatTime = (value: number) => {
  const seconds = Math.max(0, value) / 1_000_000;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(3).padStart(6, "0")}`;
};

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
): VideoEditorOperation[] {
  const visual = tracks.find((track) => track.kind === "visual");
  const audio = tracks.find((track) => track.kind === "audio");
  if (asset.mediaKind === "audio") {
    if (!audio) return [];
    return [{ type: "addClip", clip: baseClip(asset, audio.id, startUs) }];
  }
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
