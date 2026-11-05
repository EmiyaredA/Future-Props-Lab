import { LoadingState } from "@shared/ui/LoadingState";
import { subscribeAmadeusMutation, openAmadeus } from "@platform/assistant";
import { VideoEditorProjectTitle } from "./VideoEditorProjectTitle";
import { VideoEditorClipMergeDialog } from "./VideoEditorClipMergeDialog";
import { VideoEditorGapPanel } from "./VideoEditorGapPanel";
import { VideoEditorFitActions } from "./VideoEditorFitActions";
import { VideoEditorSaveGuard } from "./VideoEditorSaveGuard";
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
  Maximize2,
  Plus,
  Redo2,
  Save,
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
  timelineScrollLeftAfterZoom,
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
  registerNavigationGuard,
}: {
  projectId: string;
  onBack: () => void;
  registerNavigationGuard?: (
    guard: ((proceed: () => void) => boolean) | null,
  ) => void;
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
  const [gapPanelOpen, setGapPanelOpen] = useState(false);
  const [mergeClipIds, setMergeClipIds] = useState<string[]>();
  const [exportOpen, setExportOpen] = useState(false);
  const [segmentExportOpen, setSegmentExportOpen] = useState(false);
  const [segmentExportClipIds, setSegmentExportClipIds] = useState<string[]>();
  const [draggingAsset, setDraggingAsset] = useState<VideoEditorAsset>();
  const [previewingAssetId, setPreviewingAssetId] = useState<string>();
  const [contentViewportWidthPx, setContentViewportWidthPx] = useState(0);
  const timelineScroller = useRef<HTMLDivElement>(null);
  const [subtitleImport, setSubtitleImport] = useState<{
    fileName: string;
    result?: SubtitleParseResult;
    error?: string;
  }>();
  const [subtitleImportPending, setSubtitleImportPending] = useState(false);
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
    const nextZoom = clampTimelineZoom(value, zoomMin);
    editor.setTimelineScrollLeft(
      timelineScrollLeftAfterZoom(
        timelineScroller.current?.scrollLeft ?? editor.timelineScrollLeft,
        editor.playheadUs,
        editor.zoom,
        nextZoom,
      ),
    );
    editor.setZoom(nextZoom);
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
      subscribeAmadeusMutation((value) => {
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
    return (
      <LoadingState
        label="正在装配剪辑工作区…"
        variant="page"
        className="ve-editor-state"
      />
    );
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
      const playheadUs = editor.playheadUs;
      let clipId: string | undefined;
      await editor.commit((current) => {
        const operations = subtitleImportOperations(
          result.cues,
          current.document.tracks ?? [],
          playheadUs,
          mode,
        );
        clipId = operations.track.clips?.[0]?.id;
        return operations;
      });
      setSubtitleImport(undefined);
      selectClip(clipId);
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
  const fps = timeline.document.settings?.fps ?? 30;
  const addAsset = (
    asset: VideoEditorAsset,
    startUs = editor.playheadUs,
    trackId?: string,
  ) => {
    void editor.commit((current) => {
      const currentFps = current.document.settings?.fps ?? 30;
      const operations = operationsForAsset(
        asset,
        current.document.tracks ?? [],
        trackId ? startUs : snapUs(startUs, currentFps),
        trackId,
      );
      return {
        redo: operations,
        undo: operations
          .filter((operation) => operation.type === "addClip")
          .map((operation) => ({
            type: "removeClip" as const,
            clipId: operation.clip.id,
          })),
      };
    });
  };
  const addAssetBatch = async (selectedAssets: VideoEditorAsset[]) => {
    if (selectedAssets.length > 100)
      throw new Error("每次最多添加 100 个素材到时间线");
    const playheadUs = editor.playheadUs;
    await editor.commit((current) => {
      const tracks = current.document.tracks ?? [];
      const fps = current.document.settings?.fps ?? 30;
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
        const next = operationsForAsset(asset, tracks, cursor);
        if (!next.length)
          throw new Error(`“${asset.displayName}”无法添加到当前轨道`);
        const clip = next.find(
          (operation) => operation.type === "addClip",
        )?.clip;
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
      return {
        redo: operations,
        undo: operations
          .filter((operation) => operation.type === "addClip")
          .map((operation) => ({
            type: "removeClip" as const,
            clipId: operation.clip.id,
          })),
      };
    });
  };
  const addGenerated = (
    kind: "text" | "color",
    preset: TextPreset = "subtitle",
  ) => {
    if (kind === "text") {
      const playheadUs = editor.playheadUs;
      let clipId: string | undefined;
      editor.setPlaying(false);
      setPreviewingAssetId(undefined);
      void editor
        .commit((current) => {
          const result = textClipOperations(
            current.document.tracks ?? [],
            playheadUs,
            current.document.settings?.fps ?? 30,
            preset,
          );
          clipId = result.clip.id;
          return result;
        })
        .then(() => {
          editor.selectClip(clipId);
          setMobilePanel("inspector");
        })
        .catch(() => {});
      return;
    }
    const playheadUs = editor.playheadUs;
    void editor.commit((current) => {
      const fps = current.document.settings?.fps ?? 30;
      const track = (current.document.tracks ?? []).find(
        (item) => item.kind === "visual",
      );
      if (!track) return { redo: [], undo: [] };
      const clip: VideoEditorClip = {
        id: crypto.randomUUID(),
        trackId: track.id,
        kind,
        name: "黑幕",
        timelineStartUs: snapUs(playheadUs, fps),
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
      return {
        redo: [{ type: "addClip", clip }],
        undo: [{ type: "removeClip", clipId: clip.id }],
      };
    });
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
              <VideoEditorProjectTitle
                title={project.title}
                rename={editor.renameProject}
              />
              <small>视频剪辑工坊 · revision {timeline.revision}</small>
            </div>
          </div>
          <div className="ve-save-state">
            <Save aria-hidden />{" "}
            {editor.failedSaves ? (
              editor.notice
            ) : editor.saving ? (
              <LoadingState variant="inline" label="保存中…" />
            ) : (
              editor.notice || "已自动保存"
            )}
            <VideoEditorSaveGuard
              unsaved={editor.saving}
              busy={editor.saveBusy}
              failedCount={editor.failedSaves}
              operations={editor.failedOperations}
              discard={editor.discardFailedSaves}
              register={registerNavigationGuard}
            />
          </div>
          <div className="ve-top-actions">
            {
              <button type="button" onClick={() => void openAmadeus()}>
                ✦ Amadeus
              </button>
            }
            <VideoEditorFitActions
              tracks={tracks}
              saving={editor.saving}
              commit={editor.commit}
            />
            <button
              disabled={!editor.canUndo || editor.saving}
              onClick={() => void editor.undo()}
            >
              <Undo2 aria-hidden /> 撤销
            </button>
            <button
              disabled={!editor.canRedo || editor.saving}
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
            selectedClipIds={editor.selectedClipIds}
            onTransformDraft={editor.setTransformDraft}
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
                timeline={timeline}
                assets={assets}
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
                timeline={timeline}
                transformDraft={editor.transformDraft}
                revision={timeline.revision}
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
                void editor.commit((current) => {
                  const order =
                    Math.max(
                      -1,
                      ...(current.document.tracks ?? []).map(
                        (track) => track.order,
                      ),
                    ) + 1;
                  const track = newTrack("visual", order);
                  return {
                    redo: [{ type: "addTrack", track }],
                    undo: [{ type: "removeTrack", trackId: track.id }],
                  };
                })
              }
            >
              <Plus aria-hidden /> 视觉轨
            </button>
            <button
              onClick={() =>
                void editor.commit((current) => {
                  const order =
                    Math.max(
                      -1,
                      ...(current.document.tracks ?? []).map(
                        (track) => track.order,
                      ),
                    ) + 1;
                  const track = newTrack("mixed", order);
                  return {
                    redo: [{ type: "addTrack", track }],
                    undo: [{ type: "removeTrack", trackId: track.id }],
                  };
                })
              }
            >
              <Plus aria-hidden /> 混合轨
            </button>
            <button
              onClick={() =>
                void editor.commit((current) => {
                  const order =
                    Math.max(
                      -1,
                      ...(current.document.tracks ?? []).map(
                        (track) => track.order,
                      ),
                    ) + 1;
                  const track = newTrack("audio", order);
                  return {
                    redo: [{ type: "addTrack", track }],
                    undo: [{ type: "removeTrack", trackId: track.id }],
                  };
                })
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
          scrollerRef={timelineScroller}
          onCheckGaps={() => setGapPanelOpen(true)}
          onRequestClipMerge={
            editor.canWrite
              ? (ids) => {
                  editor.setPlaying(false);
                  setMergeClipIds(ids);
                }
              : undefined
          }
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
        {gapPanelOpen ? (
          <VideoEditorGapPanel
            timeline={timeline}
            assets={assets}
            saving={editor.saving}
            canWrite={editor.canWrite}
            commit={editor.commit}
            onAssetsChanged={() => void editor.assets.refetch()}
            onClose={() => setGapPanelOpen(false)}
            onLocate={(gap) => {
              editor.setPlaying(false);
              setPlayheadUs(gap.startUs);
              editor.setTimelineScrollLeft(
                Math.max(
                  0,
                  (gap.startUs / 1_000_000) * editor.zoom -
                    contentViewportWidthPx / 3,
                ),
              );
              setMobilePanel("preview");
            }}
          />
        ) : null}
        {exportOpen ? (
          <VideoEditorExportDialog
            projectId={projectId}
            revision={timeline.revision}
            onClose={() => setExportOpen(false)}
          />
        ) : null}
        {mergeClipIds ? (
          <VideoEditorClipMergeDialog
            projectId={projectId}
            timeline={timeline}
            assets={assets}
            clipIds={mergeClipIds}
            disabled={editor.saving || !editor.canWrite}
            commit={editor.commit}
            onClose={() => setMergeClipIds(undefined)}
            onApplied={(id) => {
              selectClip(id);
              setMergeClipIds(undefined);
              editor.setNotice("已合并片段，可撤销恢复原片段");
            }}
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
