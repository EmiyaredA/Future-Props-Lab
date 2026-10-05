import { Maximize, ScanLine } from "lucide-react";
import type { VideoEditorOperation, VideoEditorTrack } from "./types";
import type { TimelineEditBuilder } from "./timelineSaveQueue";
import { defaultTransform } from "./transformModel";

export function VideoEditorFitActions({
  tracks,
  saving,
  commit,
}: {
  tracks: VideoEditorTrack[];
  saving: boolean;
  commit: (
    redo: VideoEditorOperation[] | TimelineEditBuilder,
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
}) {
  const videos = tracks
    .flatMap((track) => track.clips ?? [])
    .filter((clip) => clip.kind === "video");
  const cover = videos.filter((clip) => clip.fitMode !== "cover");
  const scale = videos.filter(
    (clip) =>
      (clip.transform?.scaleX ?? 1) !== 1 ||
      (clip.transform?.scaleY ?? 1) !== 1,
  );
  return (
    <>
      <button
        disabled={!cover.length || saving}
        title="将当前工程的所有视频片段按比例铺满画布"
        onClick={() =>
          void commit(
            cover.map((clip) => ({
              type: "updateClip",
              clipId: clip.id,
              patch: { fitMode: "cover" },
            })),
            cover.map((clip) => ({
              type: "updateClip",
              clipId: clip.id,
              patch: {
                fitMode: clip.fitMode,
                heightPercent: clip.heightPercent,
              },
            })),
          )
        }
      >
        <ScanLine aria-hidden /> 全部铺满
      </button>
      <button
        disabled={!scale.length || saving}
        title="将当前工程的所有视频片段缩放比例统一为 1"
        onClick={() =>
          void commit(
            scale.map((clip) => ({
              type: "updateClip",
              clipId: clip.id,
              patch: {
                transform: {
                  ...defaultTransform,
                  ...clip.transform,
                  scaleX: 1,
                  scaleY: 1,
                },
              },
            })),
            scale.map((clip) => ({
              type: "updateClip",
              clipId: clip.id,
              patch: { transform: clip.transform },
            })),
          )
        }
      >
        <Maximize aria-hidden /> 全部 1 倍
      </button>
    </>
  );
}
