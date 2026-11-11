import { frameUs, operationsForAsset } from "./editorModel";
import type { VideoEditorAsset, VideoEditorTimelineDocument } from "./types";
import type { TimelineEditBuilder } from "./timelineSaveQueue";

export function prepareAssetBatch(
  assets: readonly VideoEditorAsset[],
  playheadUs: number,
  nextId: () => string,
): TimelineEditBuilder {
  if (assets.length > 100) throw new Error("每次最多添加 100 个素材到时间线");
  return ({ document }) => assetBatchEdit(document, assets, playheadUs, nextId);
}

function assetBatchEdit(
  document: VideoEditorTimelineDocument,
  selectedAssets: readonly VideoEditorAsset[],
  playheadUs: number,
  nextId: () => string,
) {
  const tracks = document.tracks ?? [];
  const fps = document.settings?.fps ?? 30;
  const nextFrame = (value: number) =>
    Math.ceil(value / frameUs(fps)) * frameUs(fps);
  let cursor = nextFrame(
    Math.max(
      playheadUs,
      ...tracks.flatMap((track) =>
        (track.clips ?? []).map(
          (clip) => clip.timelineStartUs + clip.durationUs,
        ),
      ),
    ),
  );
  const operations = selectedAssets.flatMap((asset) => {
    const next = operationsForAsset(asset, tracks, cursor, undefined, nextId);
    if (!next.length)
      throw new Error(`“${asset.displayName}”无法添加到当前轨道`);
    const clip = next.find((operation) => operation.type === "addClip")?.clip;
    cursor = nextFrame(cursor + (clip?.durationUs ?? 0));
    return next;
  });
  if (
    !operations.length ||
    operations.length > 200 ||
    operations.length < selectedAssets.length ||
    operations.some(
      (operation) =>
        operation.type === "addClip" &&
        tracks.find((track) => track.id === operation.clip.trackId)?.locked,
    )
  )
    throw new Error("所选素材无法添加到当前轨道，请检查素材类型和轨道锁定状态");
  return {
    redo: operations,
    undo: operations
      .filter((operation) => operation.type === "addClip")
      .map((operation) => ({
        type: "removeClip" as const,
        clipId: operation.clip.id,
      })),
  };
}
