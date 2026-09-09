import { useEffect, useState, type DragEvent } from "react";
import { operationsForAsset } from "./editorModel";
import { canEditAsset, assetUnavailableReason } from "./assetReadiness";
import { clipPlacementError, snapClipPosition } from "./timelineSnap";
import type { VideoEditorAsset, VideoEditorTrack } from "./types";

export function useTimelineAssetDrop({
  draggingAsset,
  assets,
  tracks,
  rawPositionUs,
  fps,
  zoom,
  seconds,
  snapEnabled,
  onDropAsset,
  onNotice,
}: {
  draggingAsset?: VideoEditorAsset;
  assets: VideoEditorAsset[];
  tracks: VideoEditorTrack[];
  rawPositionUs: (clientX: number) => number;
  fps: number;
  zoom: number;
  seconds: number;
  snapEnabled: boolean;
  onDropAsset: (
    asset: VideoEditorAsset,
    trackId: string,
    startUs: number,
  ) => void;
  onNotice?: (message: string) => void;
}) {
  const [guideUs, setGuideUs] = useState<number>();
  useEffect(() => {
    const clear = () => setGuideUs(undefined);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
      window.removeEventListener("blur", clear);
    };
  }, []);

  const placement = (
    asset: VideoEditorAsset,
    trackId: string,
    clientX: number,
  ) => {
    const position = snapClipPosition({
      candidateUs: rawPositionUs(clientX),
      durationUs: Number(asset.probe?.durationUs || 5_000_000),
      targetTrackId: trackId,
      tracks,
      movingClipIds: new Set(),
      fps,
      zoom,
      timelineEndUs: seconds * 1_000_000,
      enabled: snapEnabled,
    });
    const operations = operationsForAsset(
      asset,
      tracks,
      position.startUs,
      trackId,
    );
    const error = !canEditAsset(asset)
      ? assetUnavailableReason(asset)
      : !operations.length
        ? "该素材不适用于目标轨道"
        : operations
            .map((operation) =>
              operation.type === "addClip"
                ? clipPlacementError(
                    operation.clip,
                    position.startUs,
                    operation.clip.trackId,
                    tracks,
                    new Set(),
                  )
                : undefined,
            )
            .find(Boolean);
    return { ...position, error };
  };
  const dragOver = (event: DragEvent, trackId: string) => {
    event.preventDefault();
    if (!draggingAsset) return;
    const position = placement(draggingAsset, trackId, event.clientX);
    // Keep the drop event available for an explanatory notice even while
    // media metadata is still loading; invalid placements never commit.
    event.dataTransfer.dropEffect =
      position.error && canEditAsset(draggingAsset) ? "none" : "copy";
    setGuideUs(position.error ? undefined : position.guideUs);
  };
  const drop = (event: DragEvent, trackId: string) => {
    event.preventDefault();
    setGuideUs(undefined);
    const assetId = event.dataTransfer.getData(
      "application/x-video-editor-asset",
    );
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) return;
    const position = placement(asset, trackId, event.clientX);
    if (position.error) onNotice?.(position.error);
    else onDropAsset(asset, trackId, position.startUs);
  };
  const dragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      setGuideUs(undefined);
  };
  return {
    assetGuideUs: draggingAsset ? guideUs : undefined,
    dragOver,
    drop,
    dragLeave,
  };
}
