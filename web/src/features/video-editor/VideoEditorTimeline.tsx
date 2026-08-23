import { useMemo, useRef } from "react";
import {
  Copy,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Lock,
  Scissors,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatTime, snapUs } from "./editorModel";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimeline as Timeline,
} from "./types";

export function VideoEditorTimeline({
  timeline,
  assets,
  playheadUs,
  setPlayheadUs,
  zoom,
  selectedClipId,
  setSelectedClipId,
  commit,
  onDropAsset,
}: {
  timeline: Timeline;
  assets: VideoEditorAsset[];
  playheadUs: number;
  setPlayheadUs: (value: number) => void;
  zoom: number;
  selectedClipId?: string;
  setSelectedClipId: (value?: string) => void;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  onDropAsset: (
    asset: VideoEditorAsset,
    trackId: string,
    startUs: number,
  ) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const fps = timeline.document.settings?.fps ?? 30;
  const tracks = [...(timeline.document.tracks ?? [])].sort(
    (a, b) => a.order - b.order,
  );
  const seconds = Math.max(
    30,
    ...tracks.flatMap((track) =>
      (track.clips ?? []).map((clip) =>
        Math.ceil((clip.timelineStartUs + clip.durationUs) / 1_000_000),
      ),
    ),
  );
  const rulers = useMemo(
    () => Array.from({ length: seconds + 1 }, (_, index) => index),
    [seconds],
  );
  const positionUs = (clientX: number) => {
    const rect = scroller.current?.getBoundingClientRect();
    const scrollLeft = scroller.current?.scrollLeft ?? 0;
    return snapUs(
      ((clientX - (rect?.left ?? 0) + scrollLeft) / zoom) * 1_000_000,
      fps,
    );
  };
  const clipById = new Map(
    tracks.flatMap((track) =>
      (track.clips ?? []).map((clip) => [clip.id, clip] as const),
    ),
  );
  const selected = selectedClipId ? clipById.get(selectedClipId) : undefined;
  const deleteSelected = (ripple = false) => {
    if (!selected) return;
    void commit(
      [{ type: ripple ? "rippleDelete" : "removeClip", clipId: selected.id }],
      [{ type: "addClip", clip: selected }],
    );
    setSelectedClipId(undefined);
  };
  const splitSelected = () => {
    if (
      !selected ||
      playheadUs <= selected.timelineStartUs ||
      playheadUs >= selected.timelineStartUs + selected.durationUs
    )
      return;
    const newId = crypto.randomUUID();
    void commit(
      [
        {
          type: "splitClip",
          clipId: selected.id,
          atUs: snapUs(playheadUs, fps),
          newClipId: newId,
        },
      ],
      [
        { type: "removeClip", clipId: newId },
        {
          type: "trimClip",
          clipId: selected.id,
          timelineStartUs: selected.timelineStartUs,
          durationUs: selected.durationUs,
          sourceInUs: selected.sourceInUs,
        },
      ],
    );
  };
  return (
    <section className="ve-timeline-panel">
      <header className="ve-timeline-tools">
        <strong>时间轴</strong>
        <span>{formatTime(playheadUs)}</span>
        <button disabled={!selected} onClick={splitSelected}>
          <Scissors aria-hidden /> 分割
        </button>
        <button
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            const id = crypto.randomUUID();
            void commit(
              [{ type: "duplicateClip", clipId: selected.id, newClipId: id }],
              [{ type: "removeClip", clipId: id }],
            );
          }}
        >
          <Copy aria-hidden /> 复制
        </button>
        <button disabled={!selected} onClick={() => deleteSelected(false)}>
          <Trash2 aria-hidden /> 删除
        </button>
        <button disabled={!selected} onClick={() => deleteSelected(true)}>
          波纹删除
        </button>
      </header>
      <div className="ve-timeline-grid">
        <div className="ve-track-heads">
          <div className="ve-ruler-spacer" />
          {tracks.map((track) => (
            <div key={track.id}>
              <strong>{track.name}</strong>
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
          ))}
        </div>
        <div className="ve-tracks-scroll" ref={scroller}>
          <div
            className="ve-ruler"
            style={{ width: `${seconds * zoom}px` }}
            onPointerDown={(event) => setPlayheadUs(positionUs(event.clientX))}
          >
            {rulers.map((second) => (
              <span key={second} style={{ left: `${second * zoom}px` }}>
                {formatTime(second * 1_000_000).slice(0, 5)}
              </span>
            ))}
          </div>
          <div
            className="ve-track-canvas"
            style={{ width: `${seconds * zoom}px` }}
          >
            <i
              className="ve-playhead"
              style={{ left: `${(playheadUs / 1_000_000) * zoom}px` }}
            />
            {tracks.map((track) => (
              <div
                className={`ve-track-row ${track.kind}`}
                key={track.id}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget)
                    setPlayheadUs(positionUs(event.clientX));
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const asset = assets.find(
                    (item) =>
                      item.id ===
                      event.dataTransfer.getData(
                        "application/x-video-editor-asset",
                      ),
                  );
                  if (asset)
                    onDropAsset(asset, track.id, positionUs(event.clientX));
                  const clipId = event.dataTransfer.getData(
                    "application/x-video-editor-clip",
                  );
                  const clip = clipById.get(clipId);
                  if (clip && !track.locked) {
                    const start = positionUs(event.clientX);
                    void commit(
                      [
                        {
                          type: "moveClip",
                          clipId,
                          trackId: track.id,
                          timelineStartUs: start,
                        },
                      ],
                      [
                        {
                          type: "moveClip",
                          clipId,
                          trackId: clip.trackId,
                          timelineStartUs: clip.timelineStartUs,
                        },
                      ],
                    );
                  }
                }}
              >
                {(track.clips ?? []).map((clip: VideoEditorClip) => (
                  <button
                    key={clip.id}
                    className={`ve-clip ${clip.kind} ${selectedClipId === clip.id ? "selected" : ""}`}
                    style={{
                      left: `${(clip.timelineStartUs / 1_000_000) * zoom}px`,
                      width: `${Math.max(18, (clip.durationUs / 1_000_000) * zoom)}px`,
                    }}
                    draggable={!track.locked}
                    onDragStart={(event) =>
                      event.dataTransfer.setData(
                        "application/x-video-editor-clip",
                        clip.id,
                      )
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedClipId(clip.id);
                      if (
                        playheadUs < clip.timelineStartUs ||
                        playheadUs >= clip.timelineStartUs + clip.durationUs
                      )
                        setPlayheadUs(clip.timelineStartUs);
                    }}
                  >
                    <span>{clip.name}</span>
                    <small>{(clip.durationUs / 1_000_000).toFixed(2)}s</small>
                    {(clip.keyframes ?? []).map((keyframe) => (
                      <i
                        className="ve-key-marker"
                        key={keyframe.id}
                        style={{
                          left: `${(keyframe.timeUs / clip.durationUs) * 100}%`,
                        }}
                      />
                    ))}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
