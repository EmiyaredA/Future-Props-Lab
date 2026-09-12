import { clipPropertyAt } from "./editorModel";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTrack,
} from "./types";

export type TextPreset = "subtitle" | "title" | "plain";
export const textPresets = [
  { value: "subtitle", label: "底部字幕", description: "白字黑边，底部居中" },
  { value: "title", label: "居中标题", description: "适合片头和章节标题" },
  { value: "plain", label: "普通文字", description: "自由放置的说明文字" },
] as const;

export const defaultTextStyle = {
  align: "center" as const,
  strokeColor: "#000000",
  strokeWidth: 0,
  backgroundColor: "#000000",
  backgroundOpacity: 0,
};

export function textClipOperations(
  tracks: VideoEditorTrack[],
  playheadUs: number,
  fps: number,
  preset: TextPreset,
) {
  const start = Math.round(
    (Math.round((playheadUs * fps) / 1_000_000) * 1_000_000) / fps,
  );
  const duration = 3_000_000;
  const ordered = [...tracks].sort((a, b) => a.order - b.order);
  // Only reuse the uppermost visual layer: text must remain above all picture tracks.
  const topVisual = ordered.find((track) => track.kind !== "audio");
  const reusable =
    topVisual?.kind === "visual" &&
    topVisual.name === "文字" &&
    !topVisual.locked &&
    !topVisual.hidden &&
    !(topVisual.clips ?? []).some(
      (clip) =>
        clip.timelineStartUs < start + duration &&
        clip.timelineStartUs + clip.durationUs > start,
    )
      ? topVisual
      : undefined;
  const trackId = reusable?.id ?? crypto.randomUUID();
  const redo: VideoEditorOperation[] = [];
  const undo: VideoEditorOperation[] = [];
  if (!reusable) {
    for (const track of ordered) {
      redo.push({
        type: "reorderTrack",
        trackId: track.id,
        order: track.order + 1,
      });
      undo.push({
        type: "reorderTrack",
        trackId: track.id,
        order: track.order,
      });
    }
    redo.push({
      type: "addTrack",
      track: {
        id: trackId,
        name: "文字",
        kind: "visual",
        order: 0,
        clips: [],
        hidden: false,
        locked: false,
        muted: false,
      },
    });
    undo.unshift({ type: "removeTrack", trackId });
  }
  const clip: VideoEditorClip = {
    id: crypto.randomUUID(),
    trackId,
    kind: "text",
    name: textPresets.find((item) => item.value === preset)!.label,
    timelineStartUs: start,
    durationUs: duration,
    sourceInUs: 0,
    sourceLoop: false,
    playbackRate: 1,
    text: "请输入文字",
    fontSize: preset === "title" ? 72 : 48,
    textColor: "#ffffff",
    textMaxWidth: 1600,
    textStyle: {
      ...defaultTextStyle,
      strokeWidth: preset === "subtitle" ? 2 : 0,
    },
    fitMode: "native",
    flipX: false,
    volume: 1,
    keyframes: [],
    transform: {
      x: 960,
      y: preset === "subtitle" ? 1000 : 540,
      anchor: preset === "subtitle" ? "bottomCenter" : "center",
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      brightness: 1,
    },
  };
  redo.push({ type: "addClip", clip });
  undo.unshift({ type: "removeClip", clipId: clip.id });
  return { clip, redo, undo };
}

export function textPositionOperations(
  clip: VideoEditorClip,
  playheadUs: number,
  x: number,
  y: number,
) {
  const redo: VideoEditorOperation[] = [];
  const undo: VideoEditorOperation[] = [];
  const localUs = Math.max(
    0,
    Math.min(clip.durationUs, playheadUs - clip.timelineStartUs),
  );
  if (
    (clip.keyframes ?? []).some(
      (key) => key.property === "x" || key.property === "y",
    )
  ) {
    for (const [property, value] of [
      ["x", x],
      ["y", y],
    ] as const) {
      const existing = clip.keyframes?.find(
        (key) => key.property === property && key.timeUs === localUs,
      );
      const keyframe = {
        id: existing?.id ?? crypto.randomUUID(),
        property,
        timeUs: localUs,
        value,
        interpolation: existing?.interpolation ?? ("linear" as const),
      };
      redo.push({
        type: existing ? "updateKeyframe" : "addKeyframe",
        clipId: clip.id,
        keyframe,
      });
      undo.push(
        existing
          ? { type: "updateKeyframe", clipId: clip.id, keyframe: existing }
          : {
              type: "removeKeyframe",
              clipId: clip.id,
              keyframeId: keyframe.id,
            },
      );
    }
  } else {
    const transform = clip.transform ?? {
      x: 960,
      y: 540,
      anchor: "center" as const,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      brightness: 1,
    };
    redo.push({
      type: "updateClip",
      clipId: clip.id,
      patch: { transform: { ...transform, x, y } },
    });
    undo.push({ type: "updateClip", clipId: clip.id, patch: { transform } });
  }
  return { redo, undo };
}

export function textPosition(clip: VideoEditorClip, playheadUs: number) {
  const time = Math.max(0, playheadUs - clip.timelineStartUs);
  return {
    x: clipPropertyAt(clip, "x", time, clip.transform?.x ?? 960),
    y: clipPropertyAt(clip, "y", time, clip.transform?.y ?? 540),
  };
}
