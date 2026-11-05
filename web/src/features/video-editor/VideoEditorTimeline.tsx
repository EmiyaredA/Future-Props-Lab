import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { VideoEditorTimelineTools } from "./VideoEditorTimelineTools";
import { formatTime, newTrack, snapUs } from "./editorModel";
import { BATCH_OPS_LIMIT } from "./batchClipPatch";
import { clipDeletionLock } from "./timelineSnap";
import { getTimelineRulerStepSeconds } from "./timelineScale";
import { VideoEditorTrackHeads } from "./VideoEditorTrackHeads";
import { VideoEditorClipWaveform } from "./VideoEditorClipWaveform";
import { VideoEditorAudioCandidateMarkers } from "./VideoEditorAudioCandidateMarkers";
import { useAudioWaveformUrls } from "./useAudioWaveformUrls";
import { audioTransitionLabels } from "./audioTransitionCurves";
import {
  VideoEditorSeparator,
  type VideoEditorSeparatorProps,
} from "./VideoEditorSeparator";
import { useTimelineAssetDrop } from "./useTimelineAssetDrop";
import { useTimelineClipTrim } from "./useTimelineClipTrim";
import { useTimelineClipDrag } from "./useTimelineClipDrag";
import {
  clipEdgeTransitionWidthPercent,
  emptySeamsForTrack,
  seamTransitionStyle,
  seamTransitions,
  transitionBelongsToTrack,
} from "./timelineSeams";
import {
  VideoEditorTimelineContextMenu,
  type TimelineContextMenuState,
} from "./VideoEditorTimelineContextMenu";
import type {
  AudioSeamCandidate,
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
  scrollerRef,
  scrollLeft,
  onScrollLeftChange,
  scrollTop = 0,
  onScrollTopChange,
  trackHeaderWidth = 176,
  headerSeparator,
  selectedClipIds,
  selectClip,
  selectedTransitionId,
  selectTransition,
  openClipEdgeTransition,
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
  onContentViewportWidthChange,
  audioSeam,
  onCheckGaps,
  onRequestClipMerge,
}: {
  onCheckGaps?: () => void;
  onRequestClipMerge?: (clipIds: string[]) => void;
  draggingAsset?: VideoEditorAsset;
  timeline: Timeline;
  assets: VideoEditorAsset[];
  playheadUs: number;
  setPlayheadUs: (value: number) => void;
  zoom: number;
  scrollerRef?: RefObject<HTMLDivElement | null>;
  scrollLeft: number;
  onScrollLeftChange: (value: number) => void;
  scrollTop?: number;
  onScrollTopChange?: (value: number) => void;
  trackHeaderWidth?: number;
  headerSeparator?: VideoEditorSeparatorProps;
  selectedClipId?: string;
  selectedClipIds: string[];
  selectClip: (value?: string, additive?: boolean) => void;
  selectedTransitionId?: string;
  selectTransition?: (
    value?: string,
    target?: {
      fromClipId?: string;
      toClipId?: string;
    },
  ) => void;
  openClipEdgeTransition?: (clipId: string, edge: "in" | "out") => void;
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
  onRequestSegmentExport?: (clipIds: string[]) => void;
  hasClipboard?: boolean;
  onCopyClip?: (clipOrClips?: VideoEditorClip | VideoEditorClip[]) => void;
  onPasteClip?: () => void;
  onContentViewportWidthChange?: (widthPx: number) => void;
  audioSeam?: {
    toClipId: string;
    candidates: AudioSeamCandidate[];
    selected: number;
    onSelect: (index: number) => void;
  };
}) {
  const waveformUrls = useAudioWaveformUrls(assets);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const fallbackScroller = useRef<HTMLDivElement>(null);
  const scroller = scrollerRef ?? fallbackScroller;
  const canvas = useRef<HTMLDivElement>(null);
  const [selectionBox, setSelectionBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>();
  const [contextMenu, setContextMenu] = useState<
    TimelineContextMenuState | undefined
  >();
  const contextMenuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (Math.abs(node.scrollLeft - scrollLeft) > 0.5)
      node.scrollLeft = scrollLeft;
    if (Math.abs(node.scrollLeft - scrollLeft) > 0.5)
      onScrollLeftChange(node.scrollLeft);
  }, [scroller, scrollLeft, zoom, onScrollLeftChange]);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && Math.abs(node.scrollTop - scrollTop) > 0.5)
      node.scrollTop = scrollTop;
  }, [scroller, scrollTop]);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !onContentViewportWidthChange) return;
    const publish = () => {
      onContentViewportWidthChange(
        Math.max(0, node.clientWidth - trackHeaderWidth),
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [scroller, onContentViewportWidthChange, trackHeaderWidth]);
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
  const selectedClips = selectedClipIds
    .map((id) => clipById.get(id))
    .filter((clip): clip is VideoEditorClip => Boolean(clip));
  const hasSelection = selectedClips.length > 0;
  const transitions = seamTransitions(timeline.document.transitions);

  const deleteSelected = (
    ripple = false,
    clips: VideoEditorClip[] = selectedClips,
  ) => {
    if (!clips.length) return;
    const locked = clipDeletionLock(
      tracks,
      clips.map((clip) => clip.id),
    );
    if (locked) {
      onNotice?.(`「${locked.name}」轨道已锁定，请先解锁再删除片段`);
      return;
    }
    if (clips.length > BATCH_OPS_LIMIT) {
      onNotice?.(`一次最多删除 ${BATCH_OPS_LIMIT} 个片段`);
      return;
    }
    const ordered = ripple
      ? [...clips].sort((left, right) => {
          if (left.trackId !== right.trackId) {
            return left.trackId.localeCompare(right.trackId);
          }
          return right.timelineStartUs - left.timelineStartUs;
        })
      : clips;
    void commit(
      ordered.map((clip) => ({
        type: ripple ? ("rippleDelete" as const) : ("removeClip" as const),
        clipId: clip.id,
      })),
      ordered.map((clip) => ({ type: "addClip" as const, clip })),
    );
    selectClip(undefined);
  };

  const splitSelected = () => {
    const splitAt = snapUs(playheadUs, fps);
    const intersecting = selectedClips.filter(
      (clip) =>
        splitAt > clip.timelineStartUs &&
        splitAt < clip.timelineStartUs + clip.durationUs,
    );
    if (!intersecting.length) return;

    // Deduplicate by link group so one splitClip covers all linked peers.
    const handled = new Set<string>();
    const redo: VideoEditorOperation[] = [];
    const undo: VideoEditorOperation[] = [];
    const primaryNewIds: string[] = [];

    for (const primary of intersecting) {
      if (handled.has(primary.id)) continue;
      const linked = primary.linkGroupId
        ? [...clipById.values()].filter(
            (clip) =>
              clip.linkGroupId === primary.linkGroupId &&
              clip.timelineStartUs < splitAt &&
              splitAt < clip.timelineStartUs + clip.durationUs,
          )
        : [primary];
      for (const clip of linked) handled.add(clip.id);
      if (redo.length >= BATCH_OPS_LIMIT) {
        onNotice?.(`一次最多分割 ${BATCH_OPS_LIMIT} 组片段`);
        break;
      }
      const newId = crypto.randomUUID();
      const linkedNewClipIds = Object.fromEntries(
        linked
          .filter((clip) => clip.id !== primary.id)
          .map((clip) => [clip.id, crypto.randomUUID()]),
      );
      const allNewIds = new Map([
        [primary.id, newId],
        ...Object.entries(linkedNewClipIds),
      ]);
      primaryNewIds.push(newId);
      redo.push({
        type: "splitClip",
        clipId: primary.id,
        atUs: splitAt,
        newClipId: newId,
        linkedNewClipIds,
        newLinkGroupId: `link-${crypto.randomUUID()}`,
      });
      undo.push(
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
      );
    }
    if (!redo.length) return;
    void commit(redo, undo).then(() => {
      const [first, ...rest] = primaryNewIds;
      if (!first) return;
      selectClip(first);
      for (const id of rest) selectClip(id, true);
    });
  };

  const resolveActionClips = (anchor?: VideoEditorClip) => {
    if (anchor && selectedClipIds.includes(anchor.id) && selectedClips.length) {
      return selectedClips;
    }
    return anchor ? [anchor] : selectedClips;
  };

  const toggleClipsMute = (anchor?: VideoEditorClip) => {
    const targets = resolveActionClips(anchor);
    if (!targets.length) return;
    const muteTargets = new Map<string, VideoEditorClip>();
    for (const clip of targets) {
      const peers = clip.linkGroupId
        ? [...clipById.values()].filter(
            (item) =>
              item.linkGroupId === clip.linkGroupId && item.kind === "audio",
          )
        : [];
      for (const item of peers.length ? peers : [clip]) {
        muteTargets.set(item.id, item);
      }
    }
    const items = [...muteTargets.values()];
    if (items.length > BATCH_OPS_LIMIT) {
      onNotice?.(`一次最多静音 ${BATCH_OPS_LIMIT} 个片段`);
      return;
    }
    const muted = !(items[0]?.muted ?? false);
    void commit(
      items.map((item) => ({
        type: "updateClip" as const,
        clipId: item.id,
        patch: { muted },
      })),
      items.map((item) => ({
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

  const separateClips = (anchor?: VideoEditorClip) => {
    const candidates = resolveActionClips(anchor).filter((clip) => {
      const sourceTrack = tracks.find((track) => track.id === clip.trackId);
      return clip.kind === "video" && sourceTrack?.kind === "mixed";
    });
    if (!candidates.length) return;
    if (candidates.length > BATCH_OPS_LIMIT) {
      onNotice?.(`一次最多分离 ${BATCH_OPS_LIMIT} 个片段`);
      return;
    }
    const redo: VideoEditorOperation[] = [];
    const undo: VideoEditorOperation[] = [];
    let nextOrder = Math.max(-1, ...tracks.map((track) => track.order)) + 1;
    let visual =
      tracks.find((track) => track.kind === "visual" && !track.locked) ??
      undefined;
    let audio =
      tracks.find((track) => track.kind === "audio" && !track.locked) ??
      undefined;
    const createdTrackIds: string[] = [];

    for (const clip of candidates) {
      const visualTrack = visual ?? newTrack("visual", nextOrder++);
      const audioTrack = audio ?? newTrack("audio", nextOrder++);
      if (!visual) {
        redo.push({ type: "addTrack", track: visualTrack });
        createdTrackIds.push(visualTrack.id);
        visual = visualTrack;
      }
      if (!audio) {
        redo.push({ type: "addTrack", track: audioTrack });
        createdTrackIds.push(audioTrack.id);
        audio = audioTrack;
      }
      const audioClipId = crypto.randomUUID();
      redo.push({
        type: "separateClip",
        clipId: clip.id,
        visualTrackId: visual.id,
        audioTrackId: audio.id,
        audioClipId,
      });
      undo.unshift(
        { type: "removeClip", clipId: clip.id },
        { type: "removeClip", clipId: audioClipId },
        { type: "addClip", clip },
      );
    }
    for (const trackId of createdTrackIds.reverse()) {
      undo.push({ type: "removeTrack", trackId });
    }
    void commit(redo, undo);
    setContextMenu(undefined);
    selectClip(candidates[0]!.id);
  };

  const copyActionClips = (anchor?: VideoEditorClip) => {
    const targets = resolveActionClips(anchor);
    if (!targets.length) return;
    onCopyClip?.(targets.length === 1 ? targets[0] : targets);
  };

  const exportSelectedVideos = (anchor?: VideoEditorClip) => {
    const videoIds = resolveActionClips(anchor)
      .filter((clip) => clip.kind === "video")
      .map((clip) => clip.id);
    if (!videoIds.length || !onRequestSegmentExport) return;
    onRequestSegmentExport(videoIds);
  };
  return (
    <section className="ve-timeline-panel">
      <VideoEditorTimelineTools
        playheadUs={playheadUs}
        hasSelection={hasSelection}
        canCopy={Boolean(onCopyClip)}
        canPaste={hasClipboard && Boolean(onPasteClip)}
        snapEnabled={snapEnabled}
        onSplit={splitSelected}
        onCopy={() => copyActionClips()}
        onPaste={() => onPasteClip?.()}
        onDelete={() => deleteSelected(false)}
        onRippleDelete={() => deleteSelected(true)}
        onToggleSnap={() => setSnapEnabled(!snapEnabled)}
        onCheckGaps={onCheckGaps}
        onMerge={
          onRequestClipMerge
            ? () => onRequestClipMerge(selectedClipIds)
            : undefined
        }
      />
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
            if (event.button != null && event.button !== 0) return;
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
                  if (event.button != null && event.button !== 0) return;
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
                      if (event.button != null && event.button !== 0) return;
                      if (event.target === event.currentTarget) {
                        selectClip(undefined);
                        setPlayheadUs(positionUs(event.clientX));
                      }
                    }}
                    onDragOver={(event) => dragOver(event, track.id)}
                    onDragLeave={dragLeave}
                    onDrop={(event) => drop(event, track.id)}
                  >
                    {transitions
                      .filter((transition) =>
                        transitionBelongsToTrack(
                          transition,
                          track.id,
                          clipById,
                        ),
                      )
                      .map((transition) => (
                        <button
                          type="button"
                          key={transition.id}
                          className={`ve-timeline-transition between${selectedTransitionId === transition.id ? " selected" : ""}`}
                          style={seamTransitionStyle(
                            transition,
                            clipById,
                            zoom,
                          )}
                          aria-label={
                            transition.kind in audioTransitionLabels
                              ? `片段之间${audioTransitionLabels[transition.kind as keyof typeof audioTransitionLabels]}`
                              : "片段之间转场"
                          }
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectTransition?.(transition.id, {
                              fromClipId: transition.fromClipId,
                              toClipId: transition.toClipId,
                            });
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            selectTransition?.(transition.id, {
                              fromClipId: transition.fromClipId,
                              toClipId: transition.toClipId,
                            });
                            setContextMenu({
                              kind: "seam",
                              fromClipId: transition.fromClipId,
                              toClipId: transition.toClipId,
                              transitionId: transition.id,
                              left: event.clientX,
                              top: event.clientY,
                            });
                          }}
                        >
                          {transition.kind in audioTransitionLabels
                            ? audioTransitionLabels[
                                transition.kind as keyof typeof audioTransitionLabels
                              ]
                            : "转场"}
                          <small>
                            {(transition.durationUs / 1_000_000).toFixed(2)}s
                          </small>
                        </button>
                      ))}
                    {emptySeamsForTrack(
                      track.id,
                      clipById,
                      transitions,
                      track.kind,
                    ).map(({ from, to }) => {
                      const overlapUs = Math.max(
                        0,
                        from.timelineStartUs +
                          from.durationUs -
                          to.timelineStartUs,
                      );
                      const start =
                        track.kind === "audio"
                          ? to.timelineStartUs + overlapUs / 2
                          : to.timelineStartUs;
                      const width = 28;
                      return (
                        <button
                          type="button"
                          key={`seam-${from.id}-${to.id}`}
                          className="ve-timeline-seam-hit"
                          style={{
                            left: `${(start / 1_000_000) * zoom - width / 2}px`,
                            width: `${width}px`,
                          }}
                          aria-label={
                            track.kind === "audio"
                              ? "添加片段之间音频转场"
                              : "添加片段之间转场"
                          }
                          title={
                            track.kind === "audio"
                              ? "添加片段之间音频转场"
                              : "添加片段之间转场"
                          }
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectTransition?.(undefined, {
                              fromClipId: from.id,
                              toClipId: to.id,
                            });
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            selectTransition?.(undefined, {
                              fromClipId: from.id,
                              toClipId: to.id,
                            });
                            setContextMenu({
                              kind: "seam",
                              fromClipId: from.id,
                              toClipId: to.id,
                              left: event.clientX,
                              top: event.clientY,
                            });
                          }}
                        >
                          +
                        </button>
                      );
                    })}
                    {(track.clips ?? []).map((clip: VideoEditorClip) => (
                      <div
                        key={clip.id}
                        data-clip-id={clip.id}
                        data-amadeus-id={clip.id}
                        data-amadeus-name={clip.name}
                        data-amadeus-value={`${clip.kind} · ${(clip.durationUs / 1_000_000).toFixed(2)} 秒`}
                        className={`ve-clip ${clip.kind} ${track.kind} ${selectedClipIds.includes(clip.id) ? "selected" : ""}${dragPreview?.positions.has(clip.id) ? " dragging" : ""}${dragPreview?.positions.has(clip.id) && !dragPreview.valid ? " invalid" : ""}`}
                        style={{
                          left: `${((dragPreview?.positions.get(clip.id)?.startUs ?? trimStates?.find((item) => item.id === clip.id)?.timelineStartUs ?? clip.timelineStartUs) / 1_000_000) * zoom}px`,
                          width: `${Math.max(1, ((trimStates?.find((item) => item.id === clip.id)?.durationUs ?? clip.durationUs) / 1_000_000) * zoom)}px`,
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
                          const additive = event.metaKey || event.ctrlKey;
                          // Keep a multi-selection when grabbing an already
                          // selected member so the group drag can start.
                          if (
                            !additive &&
                            selectedClipIds.includes(clip.id) &&
                            selectedClipIds.length > 1
                          ) {
                            if (
                              playheadUs < clip.timelineStartUs ||
                              playheadUs >=
                                clip.timelineStartUs + clip.durationUs
                            )
                              setPlayheadUs(clip.timelineStartUs);
                            return;
                          }
                          selectClip(clip.id, additive);
                          if (
                            playheadUs < clip.timelineStartUs ||
                            playheadUs >= clip.timelineStartUs + clip.durationUs
                          )
                            setPlayheadUs(clip.timelineStartUs);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!selectedClipIds.includes(clip.id)) {
                            selectClip(clip.id);
                          }
                          setContextMenu({
                            kind: "clip",
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
                          {clip.kind === "audio" ? (
                            <VideoEditorClipWaveform
                              clip={clip}
                              asset={assetById.get(clip.assetId ?? "")}
                              url={
                                waveformUrls[
                                  assetById.get(clip.assetId ?? "")
                                    ?.waveformUrl ?? ""
                                ]
                              }
                            />
                          ) : null}
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
                        {audioSeam?.toClipId === clip.id ? (
                          <VideoEditorAudioCandidateMarkers {...audioSeam} />
                        ) : null}
                        {(
                          [
                            ["in", clip.transitionIn],
                            ["out", clip.transitionOut],
                          ] as const
                        ).map(([edge, transition]) => {
                          if (!transition || transition.durationUs <= 0)
                            return null;
                          const clipDurationUs =
                            trimStates?.find((item) => item.id === clip.id)
                              ?.durationUs ?? clip.durationUs;
                          const widthPct = clipEdgeTransitionWidthPercent(
                            transition.durationUs,
                            clipDurationUs,
                          );
                          if (widthPct <= 0) return null;
                          const seconds = (
                            transition.durationUs / 1_000_000
                          ).toFixed(2);
                          return (
                            <button
                              key={edge}
                              type="button"
                              className={`ve-clip-edge-transition ${edge}`}
                              style={{ width: `${widthPct}%` }}
                              aria-label={`${clip.name}：${edge === "in" ? "片段头" : "片段尾"}转场 ${seconds}s`}
                              title={`${edge === "in" ? "片段头" : "片段尾"} ${seconds}s`}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!selectedClipIds.includes(clip.id)) {
                                  selectClip(clip.id);
                                }
                                openClipEdgeTransition?.(clip.id, edge);
                              }}
                            >
                              <span>
                                {edge === "in" ? "头" : "尾"} {seconds}s
                              </span>
                            </button>
                          );
                        })}
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
        <VideoEditorTimelineContextMenu
          contextMenu={contextMenu}
          contextMenuRef={contextMenuRef}
          transitions={transitions}
          tracks={tracks}
          hasClipboard={hasClipboard}
          onClose={() => setContextMenu(undefined)}
          selectTransition={selectTransition}
          openClipEdgeTransition={openClipEdgeTransition}
          commit={commit}
          clipIsMuted={clipIsMuted}
          toggleClipsMute={toggleClipsMute}
          copyActionClips={copyActionClips}
          onCopyClip={onCopyClip}
          onPasteClip={onPasteClip}
          resolveActionClips={resolveActionClips}
          deleteSelected={deleteSelected}
          exportSelectedVideos={exportSelectedVideos}
          onRequestClipMerge={onRequestClipMerge}
          onRequestSegmentExport={onRequestSegmentExport}
          splitSelected={splitSelected}
          separateClips={separateClips}
        />
      ) : null}
    </section>
  );
}
