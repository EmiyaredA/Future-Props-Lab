import { textClipOperations, type TextPreset } from "./textModel";
import { CompactPanelTabs } from "@shared/ui/CompactPanelTabs";
import { useVideoEditorLayout } from "./useVideoEditorLayout";
import { VideoEditorSeparator } from "./VideoEditorSeparator";
import { useState } from "react";
import {
  ArrowLeft,
  Film,
  Layers3,
  Maximize,
  Plus,
  Redo2,
  Save,
  ScanLine,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { operationsForAsset, newTrack, snapUs } from "./editorModel";
import { VideoEditorAssetPanel } from "./VideoEditorAssetPanel";
import { VideoEditorExportDialog } from "./VideoEditorExportDialog";
import { VideoEditorInspector } from "./VideoEditorInspector";
import { VideoEditorPreview } from "./VideoEditorPreview";
import { VideoEditorTimeline } from "./VideoEditorTimeline";
import { VideoEditorSegmentExportDialog } from "./VideoEditorSegmentExportDialog";
import { MAX_TIMELINE_ZOOM, MIN_TIMELINE_ZOOM } from "./timelineScale";
import { useVideoEditor } from "./useVideoEditor";
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
  const workspaceLayout = useVideoEditorLayout(editor.layout, editor.setLayout);
  const [exportOpen, setExportOpen] = useState(false);
  const [segmentExportOpen, setSegmentExportOpen] = useState(false);
  const [segmentExportClipId, setSegmentExportClipId] = useState<string>();
  const [draggingAsset, setDraggingAsset] = useState<VideoEditorAsset>();
  const [titleDraft, setTitleDraft] = useState("");
  if (editor.project.isLoading || editor.timeline.isLoading)
    return <div className="ve-editor-state">正在装配剪辑工作区…</div>;
  if (!editor.project.data || !editor.timeline.data)
    return <div className="ve-editor-state">剪辑项目无法读取。</div>;
  const project = editor.project.data;
  const timeline = editor.timeline.data;
  const tracks = timeline.document.tracks ?? [];
  const nextTrackOrder =
    Math.max(-1, ...tracks.map((track) => track.order)) + 1;
  const assets = editor.assets.data?.items ?? [];
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
                value={titleDraft || project.title}
                onFocus={() => setTitleDraft(project.title)}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => {
                  const title = titleDraft.trim();
                  if (title && title !== project.title)
                    void editor.renameProject(title);
                  setTitleDraft("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setTitleDraft("");
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
                setSegmentExportClipId(undefined);
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
          onChange={setMobilePanel}
          options={[
            { value: "preview", label: "预览" },
            { value: "assets", label: "素材" },
            { value: "inspector", label: "属性" },
          ]}
        />
        <main className="ve-editor-body">
          <VideoEditorAssetPanel
            projectId={projectId}
            assets={assets}
            organization={timeline.document.assetOrganization}
            disabled={editor.saving}
            onAdd={addAsset}
            onTimelineAssetDrag={setDraggingAsset}
            onAddGenerated={addGenerated}
            onOrganizationChange={(organization) =>
              void editor.commit(
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
            setPlayheadUs={editor.setPlayheadUs}
            playing={editor.playing}
            setPlaying={editor.setPlaying}
            selectedClipId={editor.selectedClipId}
            preciseFrame={editor.preciseFrame}
            onPreciseFrameChange={editor.setPreciseFrame}
            onFrameSaved={() => editor.assets.refetch()}
            onSelectClip={editor.selectClip}
            commit={editor.commit}
            saving={editor.saving}
          />
          <VideoEditorSeparator
            {...workspaceLayout.separator("inspectorWidth")}
          />
          <VideoEditorInspector
            speedRippleEnabled={editor.speedRippleEnabled}
            setSpeedRippleEnabled={editor.setSpeedRippleEnabled}
            clip={editor.selected}
            disabled={
              editor.saving ||
              Boolean(
                tracks.find((track) => track.id === editor.selected?.trackId)
                  ?.locked,
              )
            }
            clips={tracks.flatMap((track) => track.clips ?? [])}
            playheadUs={editor.playheadUs}
            commit={editor.commit}
          />
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
          </div>
          <div>
            <button onClick={workspaceLayout.reset}>重置布局</button>
            <ZoomOut aria-hidden />
            <input
              aria-label="时间轴缩放"
              type="range"
              min={MIN_TIMELINE_ZOOM}
              max={MAX_TIMELINE_ZOOM}
              step="5"
              value={editor.zoom}
              onChange={(event) => editor.setZoom(Number(event.target.value))}
            />
            <ZoomIn aria-hidden />
            <span>{editor.zoom}px/s</span>
          </div>
        </div>
        <VideoEditorTimeline
          timeline={timeline}
          assets={assets}
          playheadUs={editor.playheadUs}
          setPlayheadUs={editor.setPlayheadUs}
          zoom={editor.zoom}
          trackHeaderWidth={editor.layout.trackHeaderWidth}
          headerSeparator={workspaceLayout.separator("trackHeaderWidth")}
          scrollTop={editor.timelineScrollTop}
          onScrollTopChange={editor.setTimelineScrollTop}
          scrollLeft={editor.timelineScrollLeft}
          onScrollLeftChange={editor.setTimelineScrollLeft}
          selectedClipId={editor.selectedClipId}
          selectedClipIds={editor.selectedClipIds}
          selectClip={editor.selectClip}
          commit={editor.commit}
          onDropAsset={(asset, trackId, startUs) =>
            addAsset(asset, startUs, trackId)
          }
          onRequestSegmentExport={(clipId) => {
            setSegmentExportClipId(clipId);
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
            selectedClipIds={
              segmentExportClipId
                ? [segmentExportClipId]
                : editor.selectedClipIds
            }
            onClose={() => {
              setSegmentExportOpen(false);
              setSegmentExportClipId(undefined);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
