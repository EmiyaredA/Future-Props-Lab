import { textClipOperations, type TextPreset } from "./textModel";
import { CompactPanelTabs } from "@shared/ui/CompactPanelTabs";
import { useVideoEditorLayout } from "./useVideoEditorLayout";
import { VideoEditorSeparator } from "./VideoEditorSeparator";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Film,
  Layers3,
  Maximize,
  Maximize2,
  Plus,
  Redo2,
  Save,
  ScanLine,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { operationsForAsset, newTrack, snapUs, frameUs } from "./editorModel";
import { VideoEditorAssetPanel } from "./VideoEditorAssetPanel";
import { VideoEditorBatchInspector } from "./VideoEditorBatchInspector";
import { VideoEditorExportDialog } from "./VideoEditorExportDialog";
import { VideoEditorInspector } from "./VideoEditorInspector";
import { VideoEditorTransitionPanel } from "./VideoEditorTransitionPanel";
import { VideoEditorAudioSeamPanel } from "./VideoEditorAudioSeamPanel";
import {
  audioSeamOperations,
  audioSeamPairForSelection,
} from "./audioSeamModel";
import { findAudioSeamCandidates } from "./api";
import { videoEditorQueryKeys } from "./queryKeys";
import { VideoEditorPreview } from "./VideoEditorPreview";
import { VideoEditorTimeline } from "./VideoEditorTimeline";
import { VideoEditorSegmentExportDialog } from "./VideoEditorSegmentExportDialog";
import { VideoEditorSubtitleImportDialog } from "./VideoEditorSubtitleImportDialog";
import {
  clampTimelineZoom,
  fittedTimelineZoom,
  MAX_TIMELINE_ZOOM,
  timelineZoomMinimum,
} from "./timelineScale";
import { useVideoEditor } from "./useVideoEditor";
import {
  parseSubtitleFile,
  subtitleImportOperations,
  type SubtitleParseResult,
  type SubtitleTimingMode,
} from "./subtitleImport";
import type { VideoEditorAsset, VideoEditorClip } from "./types";
import "./video-editor.css";
import "./video-editor-workspace.css";
import "./video-editor-timeline.css";
import "./video-editor-segments.css";
import "./video-editor-layout.css";
import "./video-editor-responsive.css";

export function VideoEditorPage({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const editor = useVideoEditor(projectId);
  const [mobilePanel, setMobilePanel] = useState("preview");
  const [rightPanel, setRightPanel] = useState<
    "inspector" | "transitions" | "audio-seam"
  >("inspector");
  const [audioSeamTarget, setAudioSeamTarget] = useState<{
    fromId: string;
    toId: string;
  }>();
  const [selectedAudioCandidate, setSelectedAudioCandidate] = useState(0);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string>();
  const [transitionTarget, setTransitionTarget] = useState<{
    fromClipId?: string;
    toClipId?: string;
  }>();
  const [clipEdgeFocus, setClipEdgeFocus] = useState<"in" | "out">("in");
  const workspaceLayout = useVideoEditorLayout(editor.layout, editor.setLayout);
  const [exportOpen, setExportOpen] = useState(false);
  const [segmentExportOpen, setSegmentExportOpen] = useState(false);
  const [segmentExportClipIds, setSegmentExportClipIds] = useState<string[]>();
  const [draggingAsset, setDraggingAsset] = useState<VideoEditorAsset>();
  const [previewingAssetId, setPreviewingAssetId] = useState<string>();
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [contentViewportWidthPx, setContentViewportWidthPx] = useState(0);
  const [subtitleImport, setSubtitleImport] = useState<{
    fileName: string;
    result?: SubtitleParseResult;
    error?: string;
  }>();
  const [subtitleImportPending, setSubtitleImportPending] = useState(false);
  const discardTitle = useRef(false);
  const {
    zoom: editorZoom,
    setZoom: editorSetZoom,
    saving: editorSaving,
    setNotice: editorSetNotice,
    selectedClipIds: editorSelectedClipIds,
  } = editor;
  const { data: timelineData, refetch: timelineRefetch } = editor.timeline;
  const contentDurationSeconds = Math.max(1, editor.durationUs / 1_000_000);
  const zoomMin = timelineZoomMinimum(
    contentViewportWidthPx,
    contentDurationSeconds,
  );
  const setTimelineZoom = (value: number) => {
    editor.setZoom(clampTimelineZoom(value, zoomMin));
  };
  useEffect(() => {
    if (!(contentViewportWidthPx > 0)) return;
    if (editorZoom < zoomMin) {
      editorSetZoom(clampTimelineZoom(zoomMin, zoomMin));
    }
  }, [contentViewportWidthPx, editorZoom, editorSetZoom, zoomMin]);
  useEffect(() => {
    const clip = (timelineData?.document.tracks ?? [])
      .flatMap((track) => track.clips ?? [])
      .find((item) => editorSelectedClipIds.includes(item.id));
    window.dispatchEvent(
      new CustomEvent("future-props:amadeus-context", {
        detail: {
          application: "视频剪辑工坊",
          projectId,
          selection: clip
            ? {
                id: clip.id,
                name: clip.name,
                value: `${clip.kind} · ${(clip.durationUs / 1_000_000).toFixed(2)} 秒`,
              }
            : undefined,
          unsaved: editorSaving,
        },
      }),
    );
  }, [projectId, timelineData, editorSelectedClipIds, editorSaving]);
  useEffect(
    () =>
      window.futurePropsDesktop?.onAmadeusMutation?.((value) => {
        const changed = value as { application?: string; projectId?: string };
        if (
          changed.application !== "video-editor" ||
          changed.projectId !== projectId
        )
          return;
        if (editorSaving) {
          editorSetNotice("Amadeus 已修改时间线；请先处理当前保存，再刷新项目");
          return;
        }
        void timelineRefetch();
      }),
    [projectId, editorSaving, timelineRefetch, editorSetNotice],
  );
  const audioSeamQuery = useQuery({
    queryKey: videoEditorQueryKeys.audioSeam(
      projectId,
      editor.timeline.data?.revision ?? -1,
      audioSeamTarget?.fromId ?? "",
      audioSeamTarget?.toId ?? "",
    ),
    enabled: Boolean(audioSeamTarget && editor.timeline.data),
    queryFn: () =>
      findAudioSeamCandidates(
        projectId,
        editor.timeline.data!.revision,
        audioSeamTarget!.fromId,
        audioSeamTarget!.toId,
      ),
    retry: false,
  });
  if (editor.project.isLoading || editor.timeline.isLoading)
    return <div className="ve-editor-state">正在装配剪辑工作区…</div>;
  if (!editor.project.data || !editor.timeline.data)
    return <div className="ve-editor-state">剪辑项目无法读取。</div>;
  const project = editor.project.data;
  const timeline = editor.timeline.data;
  const tracks = timeline.document.tracks ?? [];
  const selectableAudioSeam = audioSeamPairForSelection(
    tracks,
    editor.selectedClipIds,
  );
  const activeAudioClips = audioSeamTarget
    ? tracks
        .flatMap((track) => track.clips ?? [])
        .filter(
          (clip) =>
            clip.id === audioSeamTarget.fromId ||
            clip.id === audioSeamTarget.toId,
        )
    : [];
  const audioFrom = activeAudioClips.find(
    (clip) => clip.id === audioSeamTarget?.fromId,
  );
  const audioTo = activeAudioClips.find(
    (clip) => clip.id === audioSeamTarget?.toId,
  );
  const nextTrackOrder =
    Math.max(-1, ...tracks.map((track) => track.order)) + 1;
  const assets = editor.assets.data?.items ?? [];
  const previewingAsset = assets.find(
    (asset) => asset.id === previewingAssetId,
  );
  const clearSourcePreview = () => setPreviewingAssetId(undefined);
  const setPlayheadUs = (value: number | ((current: number) => number)) => {
    clearSourcePreview();
    editor.setPlayheadUs(value);
  };
  const selectClip = (clipId?: string, additive = false) => {
    clearSourcePreview();
    setSelectedTransitionId(undefined);
    setTransitionTarget(undefined);
    setRightPanel("inspector");
    editor.selectClip(clipId, additive);
  };
  const selectTransition = (
    transitionId?: string,
    target?: {
      fromClipId?: string;
      toClipId?: string;
    },
  ) => {
    clearSourcePreview();
    setSelectedTransitionId(transitionId);
    setTransitionTarget(target);
    setRightPanel("transitions");
    setMobilePanel("transitions");
    const highlightId = target?.toClipId ?? target?.fromClipId;
    if (highlightId) editor.selectClip(highlightId);
  };
  const openClipEdgeTransition = (clipId: string, edge: "in" | "out") => {
    clearSourcePreview();
    setSelectedTransitionId(undefined);
    setTransitionTarget(undefined);
    setClipEdgeFocus(edge);
    setRightPanel("transitions");
    setMobilePanel("transitions");
    editor.selectClip(clipId);
  };
  const fitTimelineWidth = () => {
    if (!(contentViewportWidthPx > 0)) return;
    setTimelineZoom(
      fittedTimelineZoom(contentViewportWidthPx, contentDurationSeconds),
    );
    editor.setTimelineScrollLeft(0);
  };
  const handleSubtitleFile = (file: File) => {
    setSubtitleImport({ fileName: file.name });
    void parseSubtitleFile(file)
      .then((result) => setSubtitleImport({ fileName: file.name, result }))
      .catch((error) =>
        setSubtitleImport({
          fileName: file.name,
          error: error instanceof Error ? error.message : "字幕文件解析失败",
        }),
      );
  };
  const confirmSubtitleImport = async (mode: SubtitleTimingMode) => {
    const result = subtitleImport?.result;
    if (!result?.cues.length) return;
    setSubtitleImportPending(true);
    try {
      const operations = subtitleImportOperations(
        result.cues,
        tracks,
        editor.playheadUs,
        mode,
      );
      await editor.commit(operations.redo, operations.undo);
      setSubtitleImport(undefined);
      selectClip(operations.track.clips?.[0]?.id);
      setMobilePanel("inspector");
    } catch (error) {
      setSubtitleImport((current) =>
        current
          ? {
              ...current,
              error: error instanceof Error ? error.message : "字幕导入失败",
            }
          : current,
      );
    } finally {
      setSubtitleImportPending(false);
    }
  };
  const videoClips = tracks
    .flatMap((track) => track.clips ?? [])
    .filter((clip) => clip.kind === "video");
  const videosNeedingCover = videoClips.filter(
    (clip) => clip.fitMode !== "cover",
  );
  const videosNeedingUnitScale = videoClips.filter((clip) => {
    const scaleX = clip.transform?.scaleX ?? 1;
    const scaleY = clip.transform?.scaleY ?? 1;
    return scaleX !== 1 || scaleY !== 1;
  });
  const fps = timeline.document.settings?.fps ?? 30;
  const addAsset = (
    asset: VideoEditorAsset,
    startUs = editor.playheadUs,
    trackId?: string,
  ) => {
    const operations = operationsForAsset(
      asset,
      tracks,
      trackId ? startUs : snapUs(startUs, fps),
      trackId,
    );
    if (operations.length) void editor.commit(operations);
  };
  const addAssetBatch = async (selectedAssets: VideoEditorAsset[]) => {
    if (selectedAssets.length > 100)
      throw new Error("每次最多添加 100 个素材到时间线");
    const nextFrame = (value: number) =>
      Math.ceil(value / frameUs(fps)) * frameUs(fps);
    let cursor = nextFrame(
      Math.max(
        editor.playheadUs,
        ...tracks.flatMap((track) =>
          (track.clips ?? []).map(
            (clip) => clip.timelineStartUs + clip.durationUs,
          ),
        ),
      ),
    );
    const operations = selectedAssets.flatMap((asset) => {
      const next = operationsForAsset(asset, tracks, cursor);
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
      throw new Error(
        "所选素材无法添加到当前轨道，请检查素材类型和轨道锁定状态",
      );
    await editor.commit(operations);
  };
  const addGenerated = (
    kind: "text" | "color",
    preset: TextPreset = "subtitle",
  ) => {
    if (kind === "text") {
      const { clip, redo, undo } = textClipOperations(
        tracks,
        editor.playheadUs,
        fps,
        preset,
      );
      editor.setPlaying(false);
      setPreviewingAssetId(undefined);
      void editor
        .commit(redo, undo)
        .then(() => {
          editor.selectClip(clip.id);
          setMobilePanel("inspector");
        })
        .catch(() => undefined);
      return;
    }
    const track = tracks.find((item) => item.kind === "visual");
    if (!track) return;
    const clip: VideoEditorClip = {
      id: crypto.randomUUID(),
      trackId: track.id,
      kind,
      name: "黑幕",
      timelineStartUs: snapUs(editor.playheadUs, fps),
      durationUs: snapUs(3_000_000, fps),
      sourceInUs: 0,
      playbackRate: 1,
      sourceLoop: false,

      color: "#000000",
      fontSize: 72,
      textColor: "#ffffff",
      fitMode: "cover",
      flipX: false,
      volume: 1,
      transform: {
        x: 960,
        y: 540,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        anchor: "center",
        brightness: 1,
      },
      keyframes: [],
    };
    void editor.commit(
      [{ type: "addClip", clip }],
      [{ type: "removeClip", clipId: clip.id }],
    );
  };
  return (
    <div className="ve-editor-shell" data-mobile-panel={mobilePanel}>
      <div
        className="ve-editor"
        ref={workspaceLayout.ref}
        style={workspaceLayout.style}
      >
        <header className="ve-editor-topbar">
          <button className="ve-back" onClick={onBack}>
            <ArrowLeft aria-hidden />
          </button>
          <div className="ve-editor-title">
            <Film aria-hidden />
            <div>
              <input
                aria-label="项目名称"
                maxLength={120}
                value={titleDraft ?? project.title}
                onFocus={() => setTitleDraft(project.title)}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => {
                  if (discardTitle.current) {
                    discardTitle.current = false;
                    setTitleDraft(null);
                    return;
                  }
                  const title = (titleDraft ?? project.title).trim();
                  if (title && title !== project.title)
                    void editor.renameProject(title);
                  setTitleDraft(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    discardTitle.current = true;
                    setTitleDraft(null);
                    event.currentTarget.blur();
                  }
                }}
              />
              <small>视频剪辑工坊 · revision {timeline.revision}</small>
            </div>
          </div>
          <div className="ve-save-state">
            <Save aria-hidden />{" "}
            {editor.saving ? "保存中…" : editor.notice || "已自动保存"}
          </div>
          <div className="ve-top-actions">
            {window.futurePropsDesktop?.openAmadeus && (
              <button
                type="button"
                onClick={() => void window.futurePropsDesktop?.openAmadeus?.()}
              >
                ✦ Amadeus
              </button>
            )}
            <button
              disabled={!videosNeedingCover.length || editor.saving}
              title="将当前工程的所有视频片段按比例铺满画布"
              onClick={() =>
                void editor.commit(
                  videosNeedingCover.map((clip) => ({
                    type: "updateClip",
                    clipId: clip.id,
                    patch: { fitMode: "cover" },
                  })),
                  videosNeedingCover.map((clip) => ({
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
              disabled={!videosNeedingUnitScale.length || editor.saving}
              title="将当前工程的所有视频片段缩放比例统一为 1"
              onClick={() =>
                void editor.commit(
                  videosNeedingUnitScale.map((clip) => ({
                    type: "updateClip",
                    clipId: clip.id,
                    patch: {
                      transform: {
                        ...(clip.transform ?? {
                          x: 960,
                          y: 540,
                          scaleX: 1,
                          scaleY: 1,
                          rotation: 0,
                          opacity: 1,
                          anchor: "center" as const,
                          brightness: 1,
                        }),
                        scaleX: 1,
                        scaleY: 1,
                      },
                    },
                  })),
                  videosNeedingUnitScale.map((clip) => ({
                    type: "updateClip",
                    clipId: clip.id,
                    patch: { transform: clip.transform },
                  })),
                )
              }
            >
              <Maximize aria-hidden /> 全部 1 倍
            </button>
            <button
              disabled={!editor.canUndo}
              onClick={() => void editor.undo()}
            >
              <Undo2 aria-hidden /> 撤销
            </button>
            <button
              disabled={!editor.canRedo}
              onClick={() => void editor.redo()}
            >
              <Redo2 aria-hidden /> 重做
            </button>
            <button className="primary" onClick={() => setExportOpen(true)}>
              <Film aria-hidden /> 导出视频
            </button>
            <button
              onClick={() => {
                setSegmentExportClipIds(undefined);
                setSegmentExportOpen(true);
              }}
            >
              <Layers3 aria-hidden /> 分段导出
            </button>
          </div>
        </header>
        <CompactPanelTabs
          label="剪辑面板"
          value={mobilePanel}
          onChange={(value) => {
            setMobilePanel(value);
            if (value === "transitions") setRightPanel("transitions");
            if (value === "inspector") setRightPanel("inspector");
          }}
          options={[
            { value: "preview", label: "预览" },
            { value: "assets", label: "素材" },
            { value: "inspector", label: "属性" },
            { value: "transitions", label: "转场" },
          ]}
        />
        <main className="ve-editor-body">
          <VideoEditorAssetPanel
            projectId={projectId}
            assets={assets}
            organization={timeline.document.assetOrganization}
            disabled={editor.saving || subtitleImportPending}
            previewingAssetId={previewingAssetId}
            onPreview={(asset) => {
              editor.setPlaying(false);
              setPreviewingAssetId(asset.id);
              setMobilePanel("preview");
            }}
            onAdd={addAsset}
            onAddBatch={addAssetBatch}
            onTimelineAssetDrag={setDraggingAsset}
            onAddGenerated={addGenerated}
            onImportSubtitles={handleSubtitleFile}
            onOrganizationChange={(organization) =>
              editor.commit(
                [{ type: "setAssetOrganization", organization }],
                [
                  {
                    type: "setAssetOrganization",
                    organization: timeline.document.assetOrganization ?? {
                      folders: [],
                      rootAssetIds: [],
                    },
                  },
                ],
              )
            }
          />
          <VideoEditorSeparator {...workspaceLayout.separator("assetWidth")} />
          <VideoEditorPreview
            projectId={projectId}
            projectTitle={project.title}
            timeline={timeline}
            assets={assets}
            playheadUs={editor.playheadUs}
            setPlayheadUs={setPlayheadUs}
            playing={editor.playing}
            setPlaying={editor.setPlaying}
            selectedClipId={editor.selectedClipId}
            preciseFrame={editor.preciseFrame}
            onPreciseFrameChange={editor.setPreciseFrame}
            onFrameSaved={() => editor.assets.refetch()}
            onSelectClip={selectClip}
            commit={editor.commit}
            saving={editor.saving}
            previewingAsset={previewingAsset}
            onClearPreviewingAsset={clearSourcePreview}
          />
          <VideoEditorSeparator
            {...workspaceLayout.separator("inspectorWidth")}
          />
          <div className="ve-right-panel">
            <div
              className="ve-right-panel-tabs"
              role="tablist"
              aria-label="右侧编辑面板"
            >
              <button
                type="button"
                className={rightPanel === "inspector" ? "active" : ""}
                onClick={() => {
                  setRightPanel("inspector");
                  setMobilePanel("inspector");
                }}
              >
                属性
              </button>
              <button
                type="button"
                className={rightPanel === "transitions" ? "active" : ""}
                onClick={() => {
                  setRightPanel("transitions");
                  setMobilePanel("transitions");
                }}
              >
                转场
              </button>
              <button
                type="button"
                className={rightPanel === "audio-seam" ? "active" : ""}
                disabled={!audioSeamTarget}
                onClick={() => {
                  setRightPanel("audio-seam");
                  setMobilePanel("inspector");
                }}
              >
                音频接点
              </button>
            </div>
            {rightPanel === "audio-seam" && audioFrom && audioTo ? (
              <VideoEditorAudioSeamPanel
                from={audioFrom}
                to={audioTo}
                asset={assets.find((asset) => asset.id === audioFrom.assetId)}
                data={audioSeamQuery.data}
                loading={audioSeamQuery.isLoading}
                error={
                  audioSeamQuery.error instanceof Error
                    ? audioSeamQuery.error.message
                    : undefined
                }
                selected={selectedAudioCandidate}
                onSelect={setSelectedAudioCandidate}
                fps={timeline.document.settings?.fps ?? 30}
                onClose={() => {
                  setAudioSeamTarget(undefined);
                  setRightPanel("inspector");
                }}
                onApply={async (sourceInUs, fadeUs) => {
                  const { redo, undo } = audioSeamOperations(
                    timeline,
                    audioFrom,
                    audioTo,
                    sourceInUs,
                    fadeUs,
                  );
                  await editor.commit(redo, undo);
                  setAudioSeamTarget(undefined);
                  setRightPanel("inspector");
                }}
              />
            ) : rightPanel === "transitions" ? (
              <VideoEditorTransitionPanel
                clips={tracks.flatMap((track) => track.clips ?? [])}
                tracks={tracks}
                transitions={timeline.document.transitions ?? []}
                selectedClip={editor.selected}
                selectedTransitionId={selectedTransitionId}
                target={transitionTarget}
                clipEdgeFocus={clipEdgeFocus}
                disabled={editor.saving}
                commit={editor.commit}
                onSelectTransition={(id) =>
                  selectTransition(id, transitionTarget)
                }
                onFocusClipEdge={setClipEdgeFocus}
              />
            ) : editor.selectedClipIds.length > 1 ? (
              <VideoEditorBatchInspector
                clips={tracks
                  .flatMap((track) => track.clips ?? [])
                  .filter((clip) => editor.selectedClipIds.includes(clip.id))}
                disabled={editor.saving}
                applyPatch={editor.patchSelectedClips}
              />
            ) : (
              <VideoEditorInspector
                speedRippleEnabled={editor.speedRippleEnabled}
                setSpeedRippleEnabled={editor.setSpeedRippleEnabled}
                clip={editor.selected}
                disabled={
                  editor.saving ||
                  Boolean(
                    tracks.find(
                      (track) => track.id === editor.selected?.trackId,
                    )?.locked,
                  )
                }
                clips={tracks.flatMap((track) => track.clips ?? [])}
                playheadUs={editor.playheadUs}
                commit={editor.commit}
                onOpenClipEdgeTransition={openClipEdgeTransition}
              />
            )}
          </div>
        </main>
        <VideoEditorSeparator {...workspaceLayout.separator("timelineRatio")} />
        <div className="ve-timeline-bar">
          <div>
            <button
              className={fps === 30 ? "active" : ""}
              onClick={() =>
                fps !== 30 &&
                void editor.commit([
                  { type: "updateSettings", patch: { fps: 30 } },
                ])
              }
            >
              30 FPS
            </button>
            <button
              className={fps === 60 ? "active" : ""}
              onClick={() =>
                fps !== 60 &&
                void editor.commit([
                  { type: "updateSettings", patch: { fps: 60 } },
                ])
              }
            >
              60 FPS
            </button>
            <button
              onClick={() =>
                void editor.commit([
                  {
                    type: "addTrack",
                    track: newTrack("visual", nextTrackOrder),
                  },
                ])
              }
            >
              <Plus aria-hidden /> 视觉轨
            </button>
            <button
              onClick={() =>
                void editor.commit([
                  {
                    type: "addTrack",
                    track: newTrack("mixed", nextTrackOrder),
                  },
                ])
              }
            >
              <Plus aria-hidden /> 混合轨
            </button>
            <button
              onClick={() =>
                void editor.commit([
                  {
                    type: "addTrack",
                    track: newTrack("audio", nextTrackOrder),
                  },
                ])
              }
            >
              <Plus aria-hidden /> 音频轨
            </button>
            <button
              type="button"
              disabled={!selectableAudioSeam || editor.saving}
              onClick={() => {
                if (!selectableAudioSeam) return;
                setAudioSeamTarget({
                  fromId: selectableAudioSeam.from.id,
                  toId: selectableAudioSeam.to.id,
                });
                setSelectedAudioCandidate(0);
                setRightPanel("audio-seam");
                setMobilePanel("inspector");
              }}
            >
              找相似接点
            </button>
          </div>
          <div>
            <button onClick={workspaceLayout.reset}>重置布局</button>
            <ZoomOut aria-hidden />
            <input
              aria-label="时间轴缩放"
              type="range"
              min={zoomMin}
              max={MAX_TIMELINE_ZOOM}
              step="1"
              value={Math.max(zoomMin, editor.zoom)}
              onChange={(event) => setTimelineZoom(Number(event.target.value))}
            />
            <ZoomIn aria-hidden />
            <span>{editor.zoom}px/s</span>
            <button
              type="button"
              aria-label="适配时间轴宽度"
              title="按轨道有效片段总时长缩放到当前视窗"
              onClick={fitTimelineWidth}
            >
              <Maximize2 aria-hidden /> 适配宽度
            </button>
          </div>
        </div>
        <VideoEditorTimeline
          timeline={timeline}
          assets={assets}
          audioSeam={
            audioSeamTarget && audioTo && audioSeamQuery.data
              ? {
                  toClipId: audioTo.id,
                  candidates: audioSeamQuery.data.candidates,
                  selected: selectedAudioCandidate,
                  onSelect: (index) => {
                    setSelectedAudioCandidate(index);
                    setRightPanel("audio-seam");
                  },
                }
              : undefined
          }
          playheadUs={editor.playheadUs}
          setPlayheadUs={setPlayheadUs}
          zoom={editor.zoom}
          trackHeaderWidth={editor.layout.trackHeaderWidth}
          headerSeparator={workspaceLayout.separator("trackHeaderWidth")}
          scrollTop={editor.timelineScrollTop}
          onScrollTopChange={editor.setTimelineScrollTop}
          scrollLeft={editor.timelineScrollLeft}
          onScrollLeftChange={editor.setTimelineScrollLeft}
          onContentViewportWidthChange={setContentViewportWidthPx}
          selectedClipId={editor.selectedClipId}
          selectedClipIds={editor.selectedClipIds}
          selectClip={selectClip}
          selectedTransitionId={selectedTransitionId}
          selectTransition={selectTransition}
          openClipEdgeTransition={openClipEdgeTransition}
          commit={editor.commit}
          onDropAsset={(asset, trackId, startUs) =>
            addAsset(asset, startUs, trackId)
          }
          onRequestSegmentExport={(clipIds) => {
            setSegmentExportClipIds(clipIds);
            setSegmentExportOpen(true);
          }}
          draggingAsset={draggingAsset}
          snapEnabled={editor.snapEnabled}
          setSnapEnabled={editor.setSnapEnabled}
          onNotice={editor.setNotice}
          hasClipboard={editor.hasClipboard}
          onCopyClip={editor.copyClip}
          onPasteClip={editor.pasteClipboardClip}
        />
        {exportOpen ? (
          <VideoEditorExportDialog
            projectId={projectId}
            revision={timeline.revision}
            onClose={() => setExportOpen(false)}
          />
        ) : null}
        {segmentExportOpen ? (
          <VideoEditorSegmentExportDialog
            projectId={projectId}
            timeline={timeline}
            assets={assets}
            selectedClipIds={segmentExportClipIds ?? editor.selectedClipIds}
            onClose={() => {
              setSegmentExportOpen(false);
              setSegmentExportClipIds(undefined);
            }}
          />
        ) : null}
        {subtitleImport ? (
          <VideoEditorSubtitleImportDialog
            fileName={subtitleImport.fileName}
            result={subtitleImport.result}
            error={subtitleImport.error}
            pending={subtitleImportPending}
            onCancel={() => {
              if (!subtitleImportPending) setSubtitleImport(undefined);
            }}
            onConfirm={(mode) => void confirmSubtitleImport(mode)}
          />
        ) : null}
      </div>
    </div>
  );
}
