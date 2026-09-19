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
  ClipboardPaste,
  Copy,
  Download,
  Magnet,
  Scissors,
  Trash2,
} from "lucide-react";
import { formatTime, newTrack, snapUs } from "./editorModel";
import { getTimelineRulerStepSeconds } from "./timelineScale";
import { VideoEditorTrackHeads } from "./VideoEditorTrackHeads";
import {
  VideoEditorSeparator,
  type VideoEditorSeparatorProps,
} from "./VideoEditorSeparator";
import { useTimelineAssetDrop } from "./useTimelineAssetDrop";
import { useTimelineClipTrim } from "./useTimelineClipTrim";
import { useTimelineClipDrag } from "./useTimelineClipDrag";
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
  scrollTop = 0,
  onScrollTopChange,
  trackHeaderWidth = 176,
  headerSeparator,
  selectedClipId,
  selectedClipIds,
  selectClip,
  commit,
  onDropAsset,
  draggingAsset,
  snapEnabled = true,
  setSnapEnabled = () => undefined,
  onNotice,
  onRequestSegmentExport,
  hasClipboard = false,
  onCopyClip,
  onPasteClip,
}: {
  draggingAsset?: VideoEditorAsset;
  timeline: Timeline;
  assets: VideoEditorAsset[];
  playheadUs: number;
  setPlayheadUs: (value: number) => void;
  zoom: number;
  scrollLeft: number;
  onScrollLeftChange: (value: number) => void;
  scrollTop?: number;
  onScrollTopChange?: (value: number) => void;
  trackHeaderWidth?: number;
  headerSeparator?: VideoEditorSeparatorProps;
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
  onRequestSegmentExport?: (clipId: string) => void;
  hasClipboard?: boolean;
  onCopyClip?: (clip?: VideoEditorClip) => void;
  onPasteClip?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [selectionBox, setSelectionBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>();
  const [contextMenu, setContextMenu] = useState<
    { clip: VideoEditorClip; left: number; top: number } | undefined
  >();
  const contextMenuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && Math.abs(node.scrollLeft - scrollLeft) > 0.5)
      node.scrollLeft = scrollLeft;
  }, [scrollLeft]);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && Math.abs(node.scrollTop - scrollTop) > 0.5)
      node.scrollTop = scrollTop;
  }, [scrollTop]);
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
    const rect = canvas.current?.getBoundingClientRect();
    return ((clientX - (rect?.left ?? 0)) / zoom) * 1_000_000;
  };
  const positionUs = (clientX: number) => snapUs(rawPositionUs(clientX), fps);
  const startMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".ve-clip"))
      return;
    const origin = { x: event.clientX, y: event.clientY };
    const update = (move: PointerEvent) => {
      setSelectionBox({
        x: Math.min(origin.x, move.clientX),
        y: Math.min(origin.y, move.clientY),
        w: Math.abs(move.clientX - origin.x),
        h: Math.abs(move.clientY - origin.y),
      });
    };
    const finish = (up: PointerEvent) => {
      const left = Math.min(origin.x, up.clientX);
      const right = Math.max(origin.x, up.clientX);
      const top = Math.min(origin.y, up.clientY);
      const bottom = Math.max(origin.y, up.clientY);
      if (right - left > 4 || bottom - top > 4) {
        const ids = [...document.querySelectorAll<HTMLElement>(".ve-clip")]
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return (
              rect.right > left &&
              rect.left < right &&
              rect.bottom > top &&
              rect.top < bottom
            );
          })
          .map((node) => node.dataset.clipId)
          .filter((id): id is string => Boolean(id));
        selectClip(ids[0], false);
        for (const id of ids.slice(1)) selectClip(id, true);
      }
      setSelectionBox(undefined);
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", finish);
  };
  const clipById = new Map(
    tracks.flatMap((track) =>
      (track.clips ?? []).map((clip) => [clip.id, clip] as const),
    ),
  );
  const selected = selectedClipId ? clipById.get(selectedClipId) : undefined;

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

  // Keep the menu fully inside the viewport when the clip is near an edge.
  // The menu dimensions are only known after it has been rendered, so clamp
  // the coordinates in a layout effect to avoid it being clipped by the
  // browser window.
  useLayoutEffect(() => {
    const menu = contextMenuRef.current;
    if (!menu || !contextMenu) return;
    const bounds = menu.getBoundingClientRect();
    const padding = 8;
    const left = Math.max(
      padding,
      Math.min(contextMenu.left, window.innerWidth - bounds.width - padding),
    );
    const top = Math.max(
      padding,
      Math.min(contextMenu.top, window.innerHeight - bounds.height - padding),
    );
    if (left !== contextMenu.left || top !== contextMenu.top) {
      setContextMenu((current) =>
        current ? { ...current, left, top } : current,
      );
    }
  }, [contextMenu]);

  const { dragPreview, snapGuideUs, suppressClickRef, startClipDrag } =
    useTimelineClipDrag({
      scroller,
      tracks,
      selectedClipIds,
      selectClip,
      rawPositionUs,
      fps,
      zoom,
      seconds,
      snapEnabled,
      commit,
      onNotice,
    });
  const { assetGuideUs, dragOver, drop, dragLeave } = useTimelineAssetDrop({
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
  });
  const { trimStates, trimGuideUs, startTrim, keyTrim } = useTimelineClipTrim({
    tracks,
    assets,
    rawPositionUs,
    fps,
    zoom,
    seconds,
    snapEnabled,
    commit,
    selectClip,
    onNotice,
  });
  const guideUs = trimGuideUs ?? snapGuideUs ?? assetGuideUs;
  const deleteSelected = (ripple = false) => {
    if (!selected) return;
    void commit(
      [{ type: ripple ? "rippleDelete" : "removeClip", clipId: selected.id }],
      [{ type: "addClip", clip: selected }],
    );
    selectClip(undefined);
  };
  const splitSelected = () => {
    const splitAt = snapUs(playheadUs, fps);
    if (
      !selected ||
      splitAt <= selected.timelineStartUs ||
      splitAt >= selected.timelineStartUs + selected.durationUs
    )
      return;
    const newId = crypto.randomUUID();
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
          disabled={!selected || !onCopyClip}
          onClick={() => onCopyClip?.()}
        >
          <Copy aria-hidden /> 复制
        </button>
        <button
          disabled={!hasClipboard || !onPasteClip}
          onClick={() => onPasteClip?.()}
        >
          <ClipboardPaste aria-hidden /> 粘贴
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
          title={
            snapEnabled
              ? "关闭片段接缝与跨轨边吸附"
              : "开启片段接缝与跨轨边吸附"
          }
        >
          <Magnet aria-hidden /> {snapEnabled ? "吸附" : "吸附关闭"}
        </button>
      </header>
      <div
        className="ve-timeline-viewport"
        style={
          { "--ve-track-head-width": `${trackHeaderWidth}px` } as CSSProperties
        }
      >
        {headerSeparator ? (
          <VideoEditorSeparator
            {...headerSeparator}
            className="ve-track-head-separator"
          />
        ) : null}
        <div
          className="ve-tracks-scroll"
          ref={scroller}
          style={timelineScaleStyle}
          onScroll={(event) => {
            onScrollLeftChange(event.currentTarget.scrollLeft);
            onScrollTopChange?.(event.currentTarget.scrollTop);
          }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) selectClip(undefined);
          }}
        >
          <div
            className="ve-timeline-grid"
            style={{ minWidth: `${seconds * zoom + trackHeaderWidth}px` }}
          >
            <div className="ve-track-heads">
              <div className="ve-ruler-spacer" />
              <VideoEditorTrackHeads tracks={tracks} commit={commit} />
            </div>
            <div className="ve-track-content">
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
                ref={canvas}
                style={{ width: `${seconds * zoom}px` }}
                onPointerDown={startMarquee}
              >
                {selectionBox ? (
                  <i
                    className="ve-selection-box"
                    style={{
                      left: selectionBox.x,
                      top: selectionBox.y,
                      width: selectionBox.w,
                      height: selectionBox.h,
                    }}
                  />
                ) : null}
                <i
                  className="ve-playhead"
                  style={{ left: `${(playheadUs / 1_000_000) * zoom}px` }}
                />
                {guideUs != null ? (
                  <i
                    className="ve-snap-guide"
                    style={{ left: `${(guideUs / 1_000_000) * zoom}px` }}
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
                    onDragOver={(event) => dragOver(event, track.id)}
                    onDragLeave={dragLeave}
                    onDrop={(event) => drop(event, track.id)}
                  >
                    {(track.clips ?? []).map((clip: VideoEditorClip) => (
                      <div
                        key={clip.id}
                        data-clip-id={clip.id}
                        className={`ve-clip ${clip.kind} ${track.kind} ${selectedClipIds.includes(clip.id) ? "selected" : ""}${dragPreview?.positions.has(clip.id) ? " dragging" : ""}${dragPreview?.positions.has(clip.id) && !dragPreview.valid ? " invalid" : ""}`}
                        style={{
                          left: `${((dragPreview?.positions.get(clip.id)?.startUs ?? trimStates?.find((item) => item.id === clip.id)?.timelineStartUs ?? clip.timelineStartUs) / 1_000_000) * zoom}px`,
                          width: `${Math.max(18, ((trimStates?.find((item) => item.id === clip.id)?.durationUs ?? clip.durationUs) / 1_000_000) * zoom)}px`,
                          transform:
                            dragPreview?.positions.get(clip.id)?.trackId !==
                              undefined &&
                            dragPreview.positions.get(clip.id)!.trackId !==
                              clip.trackId
                              ? `translateY(${(tracks.findIndex((item) => item.id === dragPreview.positions.get(clip.id)!.trackId) - tracks.findIndex((item) => item.id === clip.trackId)) * 56}px)`
                              : undefined,
                        }}
                        onPointerDown={(event) => startClipDrag(event, clip)}
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
                        <button
                          type="button"
                          className="ve-clip-body"
                          aria-label={`${clip.name} ${((trimStates?.find((item) => item.id === clip.id)?.durationUs ?? clip.durationUs) / 1_000_000).toFixed(2)}s`}
                        >
                          <span>{clip.name}</span>
                          <small>
                            {(
                              (trimStates?.find((item) => item.id === clip.id)
                                ?.durationUs ?? clip.durationUs) / 1_000_000
                            ).toFixed(2)}
                            s
                          </small>
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
                        {(["start", "end"] as const).map((edge) => (
                          <button
                            key={edge}
                            type="button"
                            className={`ve-trim-handle ${edge}`}
                            role="slider"
                            aria-orientation="horizontal"
                            aria-valuemin={0}
                            aria-valuenow={
                              ((trimStates?.find((item) => item.id === clip.id)
                                ?.timelineStartUs ?? clip.timelineStartUs) +
                                (edge === "end"
                                  ? (trimStates?.find(
                                      (item) => item.id === clip.id,
                                    )?.durationUs ?? clip.durationUs)
                                  : 0)) /
                              1_000_000
                            }
                            aria-valuetext={`${((trimStates?.find((item) => item.id === clip.id)?.durationUs ?? clip.durationUs) / 1_000_000).toFixed(2)} 秒片段`}
                            aria-label={`${clip.name}：调整${edge === "start" ? "开始" : "结束"}边缘`}
                            title="拖动调整时长；方向键微调一帧，Shift 加速"
                            disabled={track.locked}
                            onPointerDown={(event) =>
                              startTrim(event, clip, edge)
                            }
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => keyTrim(event, clip, edge)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {contextMenu ? (
        <div
          className="ve-clip-context-menu"
          role="menu"
          ref={contextMenuRef}
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
          <button
            role="menuitem"
            disabled={!onCopyClip}
            onClick={() => {
              const clip = contextMenu.clip;
              setContextMenu(undefined);
              selectClip(clip.id);
              onCopyClip?.(clip);
            }}
          >
            复制片段
          </button>
          <button
            role="menuitem"
            disabled={!hasClipboard || !onPasteClip}
            onClick={() => {
              setContextMenu(undefined);
              onPasteClip?.();
            }}
          >
            粘贴片段
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const clip = contextMenu.clip;
              setContextMenu(undefined);
              void commit(
                [{ type: "removeClip", clipId: clip.id }],
                [{ type: "addClip", clip }],
              );
              selectClip(undefined);
            }}
          >
            删除片段
          </button>
          {contextMenu.clip.kind === "video" && onRequestSegmentExport ? (
            <button
              role="menuitem"
              onClick={() => {
                const clip = contextMenu.clip;
                setContextMenu(undefined);
                onRequestSegmentExport?.(clip.id);
              }}
            >
              <Download aria-hidden /> 导出视频片段
            </button>
          ) : null}
          <button
            role="menuitem"
            onClick={() => {
              setContextMenu(undefined);
              splitSelected();
            }}
          >
            在播放头处分割
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
