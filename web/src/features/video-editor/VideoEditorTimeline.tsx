import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Copy,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Lock,
  Magnet,
  Scissors,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
} from "lucide-react";
import { frameUs, formatTime, newTrack, snapUs } from "./editorModel";
import { getTimelineRulerStepSeconds } from "./timelineScale";
import { canPlaceClip, linkedClipIds, snapClipStartUs } from "./timelineSnap";
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
  scrollLeft,
  onScrollLeftChange,
  selectedClipId,
  selectedClipIds,
  selectClip,
  commit,
  onDropAsset,
  snapEnabled = true,
  setSnapEnabled = () => undefined,
  onNotice,
}: {
  timeline: Timeline;
  assets: VideoEditorAsset[];
  playheadUs: number;
  setPlayheadUs: (value: number) => void;
  zoom: number;
  scrollLeft: number;
  onScrollLeftChange: (value: number) => void;
  selectedClipId?: string;
  selectedClipIds: string[];
  selectClip: (value?: string, additive?: boolean) => void;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  onDropAsset: (
    asset: VideoEditorAsset,
    trackId: string,
    startUs: number,
  ) => void;
  snapEnabled?: boolean;
  setSnapEnabled?: (value: boolean) => void;
  onNotice?: (value: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [dragPreview, setDragPreview] = useState<
    | {
        positions: Map<string, { startUs: number; trackId: string }>;
        valid: boolean;
      }
    | undefined
  >();
  const dragPreviewRef = useRef<typeof dragPreview>(undefined);
  dragPreviewRef.current = dragPreview;
  const [snapGuideUs, setSnapGuideUs] = useState<number>();
  const [contextMenu, setContextMenu] = useState<
    { clip: VideoEditorClip; left: number; top: number } | undefined
  >();
  const dragRef = useRef<{ cleanup: () => void }>(undefined);
  const dragMoveRef = useRef<
    ((event: globalThis.PointerEvent) => void) | undefined
  >(undefined);
  const dragFinishRef = useRef<((event?: Event) => void) | undefined>(
    undefined,
  );
  const suppressClickRef = useRef(false);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && Math.abs(node.scrollLeft - scrollLeft) > 0.5)
      node.scrollLeft = scrollLeft;
  }, [scrollLeft]);
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
  const rulerStepSeconds = getTimelineRulerStepSeconds(zoom);
  const rulers = useMemo(
    () =>
      Array.from(
        { length: Math.floor(seconds / rulerStepSeconds) + 1 },
        (_, index) => index * rulerStepSeconds,
      ),
    [rulerStepSeconds, seconds],
  );
  const timelineScaleStyle = {
    "--timeline-tick": `${rulerStepSeconds * zoom}px`,
  } as CSSProperties;
  const rawPositionUs = (clientX: number) => {
    const rect = scroller.current?.getBoundingClientRect();
    const scrollLeft = scroller.current?.scrollLeft ?? 0;
    return ((clientX - (rect?.left ?? 0) + scrollLeft) / zoom) * 1_000_000;
  };
  const positionUs = (clientX: number) => snapUs(rawPositionUs(clientX), fps);
  const clipById = new Map(
    tracks.flatMap((track) =>
      (track.clips ?? []).map((clip) => [clip.id, clip] as const),
    ),
  );
  const selected = selectedClipId ? clipById.get(selectedClipId) : undefined;

  useEffect(
    () => () => {
      dragRef.current?.cleanup();
    },
    [],
  );
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(undefined);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", keydown);
    };
  }, [contextMenu]);

  const startClipDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    clip: VideoEditorClip,
  ) => {
    if (event.button != null && event.button !== 0) return;
    const sourceTrack = tracks.find((track) => track.id === clip.trackId);
    if (!sourceTrack || sourceTrack.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const allClips = [...clipById.values()];
    const baseSelection = selectedClipIds.includes(clip.id)
      ? selectedClipIds
      : [clip.id];
    const movingIds = linkedClipIds(allClips, baseSelection);
    const moving = allClips.filter((item) => movingIds.has(item.id));
    const original = new Map(
      moving.map((item) => [
        item.id,
        { startUs: item.timelineStartUs, trackId: item.trackId },
      ]),
    );
    if (!selectedClipIds.includes(clip.id)) selectClip(clip.id);
    const grabOffsetUs = rawPositionUs(event.clientX) - clip.timelineStartUs;
    let moved = false;

    const update = (pointer: globalThis.PointerEvent) => {
      pointer.preventDefault();
      const row =
        typeof document.elementFromPoint === "function"
          ? document
              .elementFromPoint(pointer.clientX, pointer.clientY)
              ?.closest<HTMLElement>(".ve-track-row[data-track-id]")
          : null;
      const targetTrack = tracks.find(
        (track) => track.id === row?.dataset.trackId,
      );
      const targetTrackId = targetTrack?.id ?? clip.trackId;
      const candidate = rawPositionUs(pointer.clientX) - grabOffsetUs;
      const startUs = snapClipStartUs({
        candidateUs: candidate,
        durationUs: clip.durationUs,
        targetTrackId,
        tracks,
        movingClipIds: movingIds,
        fps,
        zoom,
        timelineEndUs: seconds * 1_000_000,
        enabled: snapEnabled,
      });
      const deltaUs = startUs - clip.timelineStartUs;
      moved ||= Math.abs(deltaUs) >= frameUs(fps);
      const positions = new Map(
        moving.map((item) => [
          item.id,
          {
            startUs: Math.max(0, item.timelineStartUs + deltaUs),
            trackId: item.id === clip.id ? targetTrackId : item.trackId,
          },
        ]),
      );
      const valid = moving.every((item) => {
        const position = positions.get(item.id)!;
        return canPlaceClip(
          item,
          position.startUs,
          position.trackId,
          tracks,
          movingIds,
        );
      });
      const nextPreview = { positions, valid };
      dragPreviewRef.current = nextPreview;
      setDragPreview(nextPreview);
      setSnapGuideUs(snapEnabled ? startUs : undefined);
    };

    const finish = (event?: Event) => {
      if (event) update(event as globalThis.PointerEvent);
      const preview = dragPreviewRef.current;
      if (moved && preview?.valid) {
        const redo: VideoEditorOperation[] = [];
        const undo: VideoEditorOperation[] = [];
        for (const item of moving) {
          const next = preview.positions.get(item.id)!;
          const previous = original.get(item.id)!;
          if (
            next.startUs === previous.startUs &&
            next.trackId === previous.trackId
          )
            continue;
          redo.push({
            type: "moveClip",
            clipId: item.id,
            trackId: next.trackId,
            timelineStartUs: next.startUs,
          });
          undo.push({
            type: "moveClip",
            clipId: item.id,
            trackId: previous.trackId,
            timelineStartUs: previous.startUs,
          });
        }
        if (redo.length) void commit(redo, undo);
      } else if (moved && preview && !preview.valid) {
        onNotice?.("该位置与其他片段重叠，无法移动");
      }
      suppressClickRef.current = moved;
      if (moved)
        window.setTimeout(() => (suppressClickRef.current = false), 100);
      setDragPreview(undefined);
      setSnapGuideUs(undefined);
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      dragRef.current = undefined;
      dragMoveRef.current = undefined;
      dragFinishRef.current = undefined;
    };
    dragRef.current = { cleanup: finish };
    dragMoveRef.current = update;
    dragFinishRef.current = finish;
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  const deleteSelected = (ripple = false) => {
    if (!selected) return;
    void commit(
      [{ type: ripple ? "rippleDelete" : "removeClip", clipId: selected.id }],
      [{ type: "addClip", clip: selected }],
    );
    selectClip(undefined);
  };
  const splitSelected = () => {
    if (
      !selected ||
      playheadUs <= selected.timelineStartUs ||
      playheadUs >= selected.timelineStartUs + selected.durationUs
    )
      return;
    const newId = crypto.randomUUID();
    const splitAt = snapUs(playheadUs, fps);
    const linked = selected.linkGroupId
      ? [...clipById.values()].filter(
          (clip) =>
            clip.linkGroupId === selected.linkGroupId &&
            clip.timelineStartUs < splitAt &&
            splitAt < clip.timelineStartUs + clip.durationUs,
        )
      : [selected];
    const newIds = Object.fromEntries(
      linked
        .filter((clip) => clip.id !== selected.id)
        .map((clip) => [clip.id, crypto.randomUUID()]),
    );
    const allNewIds = new Map([
      [selected.id, newId],
      ...Object.entries(newIds),
    ]);
    void commit(
      [
        {
          type: "splitClip",
          clipId: selected.id,
          atUs: splitAt,
          newClipId: newId,
          linkedNewClipIds: newIds,
          newLinkGroupId: `link-${crypto.randomUUID()}`,
        },
      ],
      [
        ...linked.map((clip) => ({
          type: "removeClip" as const,
          clipId: allNewIds.get(clip.id)!,
        })),
        ...linked.map((clip) => ({
          type: "trimClip" as const,
          clipId: clip.id,
          timelineStartUs: clip.timelineStartUs,
          durationUs: clip.durationUs,
          sourceInUs: clip.sourceInUs,
        })),
      ],
    ).then(() => selectClip(newId));
  };
  const toggleClipMute = (clip: VideoEditorClip) => {
    const peers = clip.linkGroupId
      ? [...clipById.values()].filter(
          (item) =>
            item.linkGroupId === clip.linkGroupId && item.kind === "audio",
        )
      : [];
    const targets = peers.length ? peers : [clip];
    const muted = !(targets[0]?.muted ?? false);
    void commit(
      targets.map((item) => ({
        type: "updateClip" as const,
        clipId: item.id,
        patch: { muted },
      })),
      targets.map((item) => ({
        type: "updateClip" as const,
        clipId: item.id,
        patch: { muted: item.muted ?? false },
      })),
    );
    setContextMenu(undefined);
  };
  const clipIsMuted = (clip: VideoEditorClip) => {
    if (!clip.linkGroupId) return Boolean(clip.muted);
    const audioPeer = [...clipById.values()].find(
      (item) => item.linkGroupId === clip.linkGroupId && item.kind === "audio",
    );
    return Boolean(audioPeer?.muted ?? clip.muted);
  };
  const separateClip = (clip: VideoEditorClip) => {
    const sourceTrack = tracks.find((track) => track.id === clip.trackId);
    if (!sourceTrack || sourceTrack.kind !== "mixed") return;
    const nextOrder = Math.max(-1, ...tracks.map((track) => track.order)) + 1;
    const visual = tracks.find(
      (track) => track.kind === "visual" && !track.locked,
    );
    const audio = tracks.find(
      (track) => track.kind === "audio" && !track.locked,
    );
    const visualTrack = visual ?? newTrack("visual", nextOrder);
    const audioTrack = audio ?? newTrack("audio", nextOrder + (visual ? 0 : 1));
    const audioClipId = crypto.randomUUID();
    void commit(
      [
        ...(visual ? [] : [{ type: "addTrack" as const, track: visualTrack }]),
        ...(audio ? [] : [{ type: "addTrack" as const, track: audioTrack }]),
        {
          type: "separateClip",
          clipId: clip.id,
          visualTrackId: visualTrack.id,
          audioTrackId: audioTrack.id,
          audioClipId,
        },
      ],
      [
        { type: "removeClip", clipId: clip.id },
        { type: "removeClip", clipId: audioClipId },
        { type: "addClip", clip },
        ...(visual
          ? []
          : [{ type: "removeTrack" as const, trackId: visualTrack.id }]),
        ...(audio
          ? []
          : [{ type: "removeTrack" as const, trackId: audioTrack.id }]),
      ],
    );
    setContextMenu(undefined);
    selectClip(clip.id);
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
        <button
          className={`ve-snap-toggle${snapEnabled ? " active" : ""}`}
          aria-pressed={snapEnabled}
          onClick={() => setSnapEnabled(!snapEnabled)}
          title={snapEnabled ? "关闭片段接缝吸附" : "开启片段接缝吸附"}
        >
          <Magnet aria-hidden /> {snapEnabled ? "吸附" : "吸附关闭"}
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
          ))}
        </div>
        <div
          className="ve-tracks-scroll"
          ref={scroller}
          style={timelineScaleStyle}
          onScroll={(event) =>
            onScrollLeftChange(event.currentTarget.scrollLeft)
          }
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) selectClip(undefined);
          }}
        >
          <div
            className="ve-ruler"
            style={{ width: `${seconds * zoom}px` }}
            onPointerDown={(event) => {
              selectClip(undefined);
              setPlayheadUs(positionUs(event.clientX));
            }}
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
            {snapGuideUs != null ? (
              <i
                className="ve-snap-guide"
                style={{ left: `${(snapGuideUs / 1_000_000) * zoom}px` }}
                aria-hidden
              />
            ) : null}
            {tracks.map((track) => (
              <div
                className={`ve-track-row ${track.kind}`}
                key={track.id}
                data-track-id={track.id}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) {
                    selectClip(undefined);
                    setPlayheadUs(positionUs(event.clientX));
                  }
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
                    type="button"
                    className={`ve-clip ${clip.kind} ${track.kind} ${selectedClipIds.includes(clip.id) ? "selected" : ""}${dragPreview?.positions.has(clip.id) ? " dragging" : ""}${dragPreview?.positions.has(clip.id) && !dragPreview.valid ? " invalid" : ""}`}
                    style={{
                      left: `${((dragPreview?.positions.get(clip.id)?.startUs ?? clip.timelineStartUs) / 1_000_000) * zoom}px`,
                      width: `${Math.max(18, (clip.durationUs / 1_000_000) * zoom)}px`,
                      transform:
                        dragPreview?.positions.get(clip.id)?.trackId !==
                          undefined &&
                        dragPreview.positions.get(clip.id)!.trackId !==
                          clip.trackId
                          ? `translateY(${(tracks.findIndex((item) => item.id === dragPreview.positions.get(clip.id)!.trackId) - tracks.findIndex((item) => item.id === clip.trackId)) * 56}px)`
                          : undefined,
                    }}
                    onPointerDown={(event) => startClipDrag(event, clip)}
                    onPointerMove={(event) =>
                      dragMoveRef.current?.(event.nativeEvent)
                    }
                    onPointerUp={(event) =>
                      dragFinishRef.current?.(event.nativeEvent)
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      selectClip(clip.id, event.metaKey || event.ctrlKey);
                      if (
                        playheadUs < clip.timelineStartUs ||
                        playheadUs >= clip.timelineStartUs + clip.durationUs
                      )
                        setPlayheadUs(clip.timelineStartUs);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      selectClip(clip.id);
                      setContextMenu({
                        clip,
                        left: event.clientX,
                        top: event.clientY,
                      });
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
      {contextMenu ? (
        <div
          className="ve-clip-context-menu"
          role="menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            role="menuitem"
            onClick={() => toggleClipMute(contextMenu.clip)}
          >
            {clipIsMuted(contextMenu.clip) ? "取消静音" : "静音"}
          </button>
          {contextMenu.clip.kind === "video" &&
          tracks.find((track) => track.id === contextMenu.clip.trackId)
            ?.kind === "mixed" ? (
            <button
              role="menuitem"
              onClick={() => separateClip(contextMenu.clip)}
            >
              分离轨道
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
