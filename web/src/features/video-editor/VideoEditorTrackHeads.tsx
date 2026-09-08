import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Lock,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
} from "lucide-react";
import { trackKindLabels } from "./editorModel";
import type { VideoEditorTrack, VideoEditorOperation } from "./types";

export function VideoEditorTrackHeads({
  tracks,
  commit,
}: {
  tracks: VideoEditorTrack[];
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
}) {
  return (
    <>
      {tracks.map((track) => (
        <div
          key={track.id}
          className={`ve-track-head ${track.kind}`}
          role="group"
          aria-label={`${trackKindLabels[track.kind]}：${track.name}`}
        >
          <div className="ve-track-heading">
            <span className="ve-track-kind">{trackKindLabels[track.kind]}</span>
            <strong title={track.name}>{track.name}</strong>
          </div>
          <div className="ve-track-actions">
            <button
              aria-label={track.locked ? "解锁轨道" : "锁定轨道"}
              onClick={() =>
                void commit([
                  {
                    type: "updateTrack",
                    trackId: track.id,
                    patch: { locked: !track.locked },
                  },
                ])
              }
            >
              {track.locked ? <Lock aria-hidden /> : <Unlock aria-hidden />}
            </button>
            {track.kind === "visual" ? (
              <button
                aria-label={track.hidden ? "显示轨道" : "隐藏轨道"}
                onClick={() =>
                  void commit([
                    {
                      type: "updateTrack",
                      trackId: track.id,
                      patch: { hidden: !track.hidden },
                    },
                  ])
                }
              >
                {track.hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </button>
            ) : (
              <button
                aria-label={track.muted ? "取消静音" : "静音轨道"}
                onClick={() =>
                  void commit([
                    {
                      type: "updateTrack",
                      trackId: track.id,
                      patch: { muted: !track.muted },
                    },
                  ])
                }
              >
                {track.muted ? (
                  <VolumeX aria-hidden />
                ) : (
                  <Volume2 aria-hidden />
                )}
              </button>
            )}
            {track.kind === "mixed" ? (
              <button
                aria-label={track.hidden ? "显示轨道" : "隐藏轨道"}
                onClick={() =>
                  void commit([
                    {
                      type: "updateTrack",
                      trackId: track.id,
                      patch: { hidden: !track.hidden },
                    },
                  ])
                }
              >
                {track.hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </button>
            ) : null}
            <button
              aria-label="轨道上移"
              disabled={
                track.order === Math.min(...tracks.map((item) => item.order))
              }
              onClick={() => {
                const previous = tracks.find(
                  (item) => item.order === track.order - 1,
                );
                if (previous)
                  void commit([
                    {
                      type: "reorderTrack",
                      trackId: track.id,
                      order: previous.order,
                    },
                    {
                      type: "reorderTrack",
                      trackId: previous.id,
                      order: track.order,
                    },
                  ]);
              }}
            >
              <ArrowUp aria-hidden />
            </button>
            <button
              aria-label="轨道下移"
              disabled={
                track.order === Math.max(...tracks.map((item) => item.order))
              }
              onClick={() => {
                const next = tracks.find(
                  (item) => item.order === track.order + 1,
                );
                if (next)
                  void commit([
                    {
                      type: "reorderTrack",
                      trackId: track.id,
                      order: next.order,
                    },
                    {
                      type: "reorderTrack",
                      trackId: next.id,
                      order: track.order,
                    },
                  ]);
              }}
            >
              <ArrowDown aria-hidden />
            </button>
            <button
              aria-label="删除空轨道"
              disabled={
                Boolean(track.clips?.length) ||
                tracks.filter((item) => item.kind === track.kind).length === 1
              }
              onClick={() =>
                void commit([{ type: "removeTrack", trackId: track.id }])
              }
            >
              <Trash2 aria-hidden />
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
