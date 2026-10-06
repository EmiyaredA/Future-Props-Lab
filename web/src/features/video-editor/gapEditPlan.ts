import { reconcileAudioTransitionOperations } from "./audioTransitionOperations";
import { planFreezeGaps } from "./gapFreeze";
import { findTimelineGaps, type TimelineGap } from "./timelineGaps";
import type { TimelineEdit } from "./timelineSaveQueue";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorTimeline,
} from "./types";

export type GapProcessingMode = "extend" | "ripple" | "freeze";
export type GapEditPlan = TimelineEdit & {
  issues: string[];
  affectedClipIds: string[];
  durationUs: number;
};

/** Plan the whole selection before submitting one atomic, undoable batch. */
export function planGapEdits(
  timeline: VideoEditorTimeline,
  assets: VideoEditorAsset[],
  selected: TimelineGap[],
  mode: GapProcessingMode,
): GapEditPlan {
  if (mode === "freeze") return planFreezeGaps(timeline, assets, selected);
  const issues = new Set<string>();
  const current = new Map(
    findTimelineGaps(timeline).map((gap) => [gap.id, gap]),
  );
  const gaps = [...new Map(selected.map((gap) => [gap.id, gap])).values()];
  if (gaps.some((gap) => !current.has(gap.id)))
    issues.add("接点已变化，请重新检查并选择空隙");
  const tracks = timeline.document.tracks ?? [];
  const all = tracks.flatMap((track) => track.clips ?? []);
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const deltas = new Map<string, number>();
  const selectedTracks = new Set(gaps.map((gap) => gap.trackId));
  for (const clip of all) {
    if (mode === "ripple" && selectedTracks.has(clip.trackId)) {
      deltas.set(
        clip.id,
        -gaps
          .filter(
            (gap) =>
              gap.trackId === clip.trackId && gap.endUs <= clip.timelineStartUs,
          )
          .reduce((sum, gap) => sum + gap.durationUs, 0),
      );
    } else if (mode === "extend") {
      const delta = gaps
        .filter((gap) => gap.fromClipId === clip.id)
        .reduce((sum, gap) => sum + gap.durationUs, 0);
      if (delta) deltas.set(clip.id, delta);
    }
  }
  const groups = new Map<string, VideoEditorClip[]>();
  for (const clip of all) {
    if (clip.linkGroupId)
      groups.set(clip.linkGroupId, [
        ...(groups.get(clip.linkGroupId) ?? []),
        clip,
      ]);
  }
  for (const members of groups.values()) {
    const requested = new Set(
      members
        .filter((clip) => deltas.has(clip.id))
        .map((clip) => deltas.get(clip.id)!),
    );
    if (requested.size > 1) {
      issues.add(
        `关联组「${members[0].name}」需要不同调整量，请分别处理这些空隙`,
      );
    } else if (requested.size) {
      const delta = [...requested][0];
      for (const clip of members) deltas.set(clip.id, delta);
    }
  }
  const originals = all.filter((clip) => Boolean(deltas.get(clip.id)));
  const states = originals.map((clip) => {
    const delta = deltas.get(clip.id)!;
    const track = trackById.get(clip.trackId)!;
    if (track.locked) issues.add(`轨道「${track.name}」已锁定`);
    const next = structuredClone(clip);
    if (mode === "ripple") {
      next.timelineStartUs += delta;
      if (next.timelineStartUs < 0)
        issues.add(`片段「${clip.name}」会移到时间轴起点之前`);
    } else {
      next.durationUs += delta;
      if (["video", "audio"].includes(clip.kind)) {
        const asset = assetsById.get(clip.assetId ?? "");
        const duration = Number(asset?.probe?.durationUs);
        if (asset?.processingStatus !== "ready") {
          issues.add(`素材「${clip.name}」尚未准备好`);
        } else if (!Number.isFinite(duration) || duration <= 0) {
          issues.add(`素材「${clip.name}」长度未知`);
        } else if (
          (clip.sourceInUs ?? 0) +
            Math.floor(next.durationUs * (clip.playbackRate ?? 1)) >
          duration
        ) {
          issues.add(`素材「${clip.name}」剩余长度不足`);
        }
      } else if (
        clip.kind === "image" &&
        assetsById.get(clip.assetId ?? "")?.processingStatus !== "ready"
      ) {
        issues.add(`素材「${clip.name}」尚未准备好`);
      }
    }
    return next;
  });
  const changed = new Map(states.map((clip) => [clip.id, clip]));
  const finalClips = new Map(
    all.map((clip) => [clip.id, changed.get(clip.id) ?? clip]),
  );
  for (const track of tracks.filter((track) => track.kind !== "audio")) {
    const ordered = (track.clips ?? [])
      .map((clip) => finalClips.get(clip.id)!)
      .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
    let end = 0;
    for (const clip of ordered) {
      if (clip.timelineStartUs < end)
        issues.add(`轨道「${track.name}」处理后片段会重叠`);
      end = Math.max(end, clip.timelineStartUs + clip.durationUs);
    }
  }
  // Picture transitions require an exact seam even after linked cross-track moves.
  for (const transition of timeline.document.transitions ?? []) {
    if (transition.kind.startsWith("audio-")) continue;
    const left = finalClips.get(transition.fromClipId);
    const right = finalClips.get(transition.toClipId);
    if (
      left &&
      right &&
      left.timelineStartUs + left.durationUs !== right.timelineStartUs
    )
      issues.add("处理会破坏已有画面转场接点，请调整选择");
  }
  const edit =
    issues.size || !states.length
      ? { redo: [], undo: [] }
      : reconcileAudioTransitionOperations(
          timeline,
          [{ type: "restoreClipStates", clips: states }],
          [{ type: "restoreClipStates", clips: structuredClone(originals) }],
        );
  if (edit.redo.length > 200)
    issues.add("本次涉及过多音频转场，请减少选择后处理");
  return {
    redo: issues.size ? [] : edit.redo,
    undo: issues.size ? [] : edit.undo,
    issues: [...issues],
    affectedClipIds: originals.map((clip) => clip.id),
    durationUs: gaps.reduce((sum, gap) => sum + gap.durationUs, 0),
  };
}
