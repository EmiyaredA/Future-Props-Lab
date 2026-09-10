import { frameUs } from "./editorModel";
import { linkedClipIds, snapClipPosition } from "./timelineSnap";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorTrack,
} from "./types";

export type TrimEdge = "start" | "end";
export function clipTrimPreview({
  clip,
  edge,
  candidateUs,
  tracks,
  assets,
  fps,
  zoom,
  seconds,
  snapEnabled,
}: {
  clip: VideoEditorClip;
  edge: TrimEdge;
  candidateUs: number;
  tracks: VideoEditorTrack[];
  assets: VideoEditorAsset[];
  fps: number;
  zoom: number;
  seconds: number;
  snapEnabled: boolean;
}) {
  const all = tracks.flatMap((track) => track.clips ?? []);
  const ids = linkedClipIds(all, [clip.id]);
  const originals = all.filter((item) => ids.has(item.id));
  const boundary =
    clip.timelineStartUs + (edge === "end" ? clip.durationUs : 0);
  let minimum = -Infinity;
  let maximum = Infinity;
  for (const item of originals) {
    const track = tracks.find((track) => track.id === item.trackId)!;
    if (track.locked)
      return { originals, error: "片段或关联音频所在轨道已锁定，请先解锁" };
    const media = item.kind === "video" || item.kind === "audio";
    const rate = item.playbackRate ?? 1;
    const start = item.timelineStartUs;
    const end = start + item.durationUs;
    const minDuration = Math.min(frameUs(fps), item.durationUs);
    if (edge === "start") {
      minimum = Math.max(
        minimum,
        -start,
        media ? -Math.floor((item.sourceInUs ?? 0) / rate) : -Infinity,
      );
      maximum = Math.min(maximum, item.durationUs - minDuration);
    } else {
      minimum = Math.max(minimum, minDuration - item.durationUs);
      const duration = Number(
        assets.find((asset) => asset.id === item.assetId)?.probe?.durationUs,
      );
      if (media && !item.sourceLoop) {
        // Unknown source lengths may be shortened, but never extended blindly.
        maximum = Math.min(
          maximum,
          Number.isFinite(duration) && duration > 0
            ? Math.floor((duration - (item.sourceInUs ?? 0)) / rate) -
                item.durationUs
            : 0,
        );
      }
    }
    if (track.kind === "audio") continue;
    for (const other of track.clips ?? []) {
      if (ids.has(other.id)) continue;
      const otherEnd = other.timelineStartUs + other.durationUs;
      if (edge === "start" && otherEnd <= start)
        minimum = Math.max(minimum, otherEnd - start);
      if (edge === "end" && other.timelineStartUs >= end)
        maximum = Math.min(maximum, other.timelineStartUs - end);
    }
  }
  const snapped = snapClipPosition({
    candidateUs,
    durationUs: 0,
    targetTrackId: clip.trackId,
    tracks,
    movingClipIds: ids,
    fps,
    zoom,
    timelineEndUs: seconds * 1_000_000,
    enabled: snapEnabled,
  });
  const delta = Math.round(
    Math.max(minimum, Math.min(maximum, snapped.startUs - boundary)),
  );
  const states = originals.map((item) => ({
    ...item,
    timelineStartUs: item.timelineStartUs + (edge === "start" ? delta : 0),
    durationUs: item.durationUs + (edge === "start" ? -delta : delta),
    sourceInUs:
      (item.sourceInUs ?? 0) +
      (edge === "start" && ["video", "audio"].includes(item.kind)
        ? Math.round(delta * (item.playbackRate ?? 1))
        : 0),
  }));
  return {
    originals,
    states,
    guideUs: boundary + delta === snapped.guideUs ? snapped.guideUs : undefined,
  };
}
