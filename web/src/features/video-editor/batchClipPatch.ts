import type { VideoEditorClip, VideoEditorOperation } from "./types";
import {
  type ChromaKey,
  mergeChromaKey,
  resolveChromaKey,
} from "./chromaPresets";

export const BATCH_OPS_LIMIT = 200;

export type VolumeAdjustMode = "set" | "delta" | "mute" | "unmute";

export type TransformField = "x" | "y" | "scaleX" | "scaleY" | "rotation";

export type BatchFitMode = "cover" | "contain" | "native";

export type BatchAudioPatch =
  | { mode: "set"; volume: number }
  | { mode: "delta"; delta: number }
  | { mode: "mute" }
  | { mode: "unmute" };

export type BatchVisualPatch = {
  fitMode?: BatchFitMode;
  transform?: Partial<Record<TransformField, number>>;
};

export type BatchChromaPatch = Partial<ChromaKey>;

export type BatchClipPatch = {
  audio?: BatchAudioPatch;
  visual?: BatchVisualPatch;
  chroma?: BatchChromaPatch;
};

export type MixedValue<T> =
  | { mixed: true }
  | { mixed: false; value: T };

export type BatchSkip = { name: string; reason: string };

export type BatchPatchResult = {
  redo: VideoEditorOperation[];
  undo: VideoEditorOperation[];
  applied: number;
  skipped: BatchSkip[];
  truncated: boolean;
};

const defaultTransform = {
  x: 960,
  y: 540,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  anchor: "center" as const,
  brightness: 1,
};

export const clipSupportsVolume = (clip: VideoEditorClip) =>
  clip.kind === "video" || clip.kind === "audio";

export const clipSupportsFitMode = (clip: VideoEditorClip) =>
  clip.kind === "video" || clip.kind === "image";

export const clipSupportsTransform = (clip: VideoEditorClip) =>
  clip.kind !== "audio";

export const clipSupportsChroma = (clip: VideoEditorClip) =>
  clip.kind === "video" || clip.kind === "image";

export function clipTransform(clip: VideoEditorClip) {
  return { ...defaultTransform, ...clip.transform };
}

export function mixedValues<T>(values: T[]): MixedValue<T> {
  if (!values.length) return { mixed: true };
  const first = values[0];
  return values.every((value) => Object.is(value, first))
    ? { mixed: false, value: first }
    : { mixed: true };
}

export function clampVolume(value: number) {
  return Math.max(0, Math.min(4, value));
}

function hasChromaDirty(chroma?: BatchChromaPatch) {
  return Boolean(chroma && Object.keys(chroma).length > 0);
}

function patchAppliesToClip(clip: VideoEditorClip, patch: BatchClipPatch) {
  if (patch.audio && clipSupportsVolume(clip)) return true;
  if (patch.visual?.fitMode && clipSupportsFitMode(clip)) return true;
  if (
    patch.visual?.transform &&
    Object.keys(patch.visual.transform).length > 0 &&
    clipSupportsTransform(clip)
  ) {
    return true;
  }
  if (hasChromaDirty(patch.chroma) && clipSupportsChroma(clip)) return true;
  return false;
}

function skipReason(clip: VideoEditorClip, patch: BatchClipPatch): string {
  const wantsAudio = Boolean(patch.audio);
  const wantsFit = Boolean(patch.visual?.fitMode);
  const wantsTransform = Boolean(
    patch.visual?.transform &&
      Object.keys(patch.visual.transform).length > 0,
  );
  const wantsChroma = hasChromaDirty(patch.chroma);
  const unsupported: string[] = [];
  if (wantsAudio && !clipSupportsVolume(clip)) unsupported.push("音量或静音");
  if (wantsFit && !clipSupportsFitMode(clip)) unsupported.push("画面适配");
  if (wantsTransform && !clipSupportsTransform(clip))
    unsupported.push("画面变换");
  if (wantsChroma && !clipSupportsChroma(clip)) unsupported.push("抠像");
  if (unsupported.length === 1) return `不支持${unsupported[0]}`;
  if (unsupported.length > 1) return `不支持${unsupported.join("、")}`;
  return "不支持所选属性";
}

function chromaChanged(current: ChromaKey, next: ChromaKey) {
  return JSON.stringify(current) !== JSON.stringify(next);
}

function buildClipPatch(
  clip: VideoEditorClip,
  patch: BatchClipPatch,
): {
  next: Record<string, unknown>;
  previous: Record<string, unknown>;
} | null {
  const next: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};

  if (patch.audio && clipSupportsVolume(clip)) {
    if (patch.audio.mode === "set") {
      const volume = clampVolume(patch.audio.volume);
      if (volume !== clip.volume) {
        next.volume = volume;
        previous.volume = clip.volume;
      }
    } else if (patch.audio.mode === "delta") {
      const volume = clampVolume(clip.volume + patch.audio.delta);
      if (volume !== clip.volume) {
        next.volume = volume;
        previous.volume = clip.volume;
      }
    } else if (patch.audio.mode === "mute") {
      if (!(clip.muted ?? false)) {
        next.muted = true;
        previous.muted = clip.muted ?? false;
      }
    } else if (patch.audio.mode === "unmute") {
      if (clip.muted) {
        next.muted = false;
        previous.muted = clip.muted;
      }
    }
  }

  if (patch.visual?.fitMode && clipSupportsFitMode(clip)) {
    if (clip.fitMode !== patch.visual.fitMode) {
      next.fitMode = patch.visual.fitMode;
      previous.fitMode = clip.fitMode;
      previous.heightPercent = clip.heightPercent;
    }
  }

  const transformFields = patch.visual?.transform;
  if (
    transformFields &&
    Object.keys(transformFields).length > 0 &&
    clipSupportsTransform(clip)
  ) {
    const current = clipTransform(clip);
    const merged = { ...current };
    let changed = false;
    for (const [key, value] of Object.entries(transformFields) as [
      TransformField,
      number,
    ][]) {
      if (value !== undefined && value !== current[key]) {
        merged[key] = value;
        changed = true;
      }
    }
    if (changed) {
      next.transform = merged;
      previous.transform = clip.transform ?? { ...defaultTransform };
    }
  }

  if (hasChromaDirty(patch.chroma) && clipSupportsChroma(clip)) {
    const current = resolveChromaKey(clip);
    const merged = mergeChromaKey(clip, patch.chroma!);
    if (chromaChanged(current, merged)) {
      next.chromaKey = merged;
      previous.chromaKey = clip.chromaKey ?? null;
    }
  }

  if (!Object.keys(next).length) return null;
  return { next, previous };
}

export function buildBatchClipOperations(
  clips: VideoEditorClip[],
  patch: BatchClipPatch,
): BatchPatchResult {
  const redo: VideoEditorOperation[] = [];
  const undo: VideoEditorOperation[] = [];
  const skipped: BatchSkip[] = [];
  let applied = 0;
  let truncated = false;

  const hasIntent =
    Boolean(patch.audio) ||
    Boolean(patch.visual?.fitMode) ||
    Boolean(
      patch.visual?.transform &&
        Object.keys(patch.visual.transform).length > 0,
    ) ||
    hasChromaDirty(patch.chroma);
  if (!hasIntent) {
    return { redo, undo, applied: 0, skipped, truncated: false };
  }

  for (const clip of clips) {
    if (!patchAppliesToClip(clip, patch)) {
      skipped.push({ name: clip.name, reason: skipReason(clip, patch) });
      continue;
    }
    if (redo.length >= BATCH_OPS_LIMIT) {
      truncated = true;
      skipped.push({
        name: clip.name,
        reason: `超过单次 ${BATCH_OPS_LIMIT} 条操作上限`,
      });
      continue;
    }
    const built = buildClipPatch(clip, patch);
    if (built) {
      redo.push({ type: "updateClip", clipId: clip.id, patch: built.next });
      undo.push({
        type: "updateClip",
        clipId: clip.id,
        patch: built.previous,
      });
    }
    applied += 1;
  }

  return { redo, undo, applied, skipped, truncated };
}
