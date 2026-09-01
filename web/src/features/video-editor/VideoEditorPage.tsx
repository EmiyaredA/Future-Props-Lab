import { useState } from "react";
import {
  ArrowLeft,
  Film,
  Layers3,
  Plus,
  Redo2,
  Save,
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

export function VideoEditorPage({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const editor = useVideoEditor(projectId);
  const [exportOpen, setExportOpen] = useState(false);
  const [segmentExportOpen, setSegmentExportOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  if (editor.project.isLoading || editor.timeline.isLoading)
    return <div className="ve-editor-state">正在装配剪辑工作区…</div>;
  if (!editor.project.data || !editor.timeline.data)
    return <div className="ve-editor-state">剪辑项目无法读取。</div>;
  const project = editor.project.data;
  const timeline = editor.timeline.data;
  const tracks = timeline.document.tracks ?? [];
  const assets = editor.assets.data?.items ?? [];
  const fps = timeline.document.settings?.fps ?? 30;
  const addAsset = (
    asset: VideoEditorAsset,
    startUs = editor.playheadUs,
    trackId?: string,
  ) => {
    const operations = operationsForAsset(
      asset,
      tracks,
      snapUs(startUs, fps),
      trackId,
    );
    if (operations.length) void editor.commit(operations);
  };
  const addGenerated = (kind: "text" | "color") => {
    const track = tracks.find((item) => item.kind === "visual");
    if (!track) return;
    const clip: VideoEditorClip = {
      id: crypto.randomUUID(),
      trackId: track.id,
      kind,
      name: kind === "text" ? "文字卡" : "黑幕",
      timelineStartUs: snapUs(editor.playheadUs, fps),
      durationUs: snapUs(3_000_000, fps),
      sourceInUs: 0,
      sourceLoop: false,
      text: kind === "text" ? "双击属性编辑文字" : undefined,
      color: kind === "color" ? "#000000" : undefined,
      fontSize: 72,
      textColor: "#ffffff",
      fitMode: "native",
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
    <div className="ve-editor">
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
          <button disabled={!editor.canUndo} onClick={() => void editor.undo()}>
            <Undo2 aria-hidden /> 撤销
          </button>
          <button disabled={!editor.canRedo} onClick={() => void editor.redo()}>
            <Redo2 aria-hidden /> 重做
          </button>
          <button className="primary" onClick={() => setExportOpen(true)}>
            <Film aria-hidden /> 导出视频
          </button>
          <button onClick={() => setSegmentExportOpen(true)}>
            <Layers3 aria-hidden /> 分段导入
          </button>
        </div>
      </header>
      <main className="ve-editor-body">
        <VideoEditorAssetPanel
          projectId={projectId}
          assets={assets}
          onAdd={addAsset}
          onAddGenerated={addGenerated}
        />
        <VideoEditorPreview
          projectId={projectId}
          timeline={timeline}
          assets={assets}
          playheadUs={editor.playheadUs}
          setPlayheadUs={editor.setPlayheadUs}
          playing={editor.playing}
          setPlaying={editor.setPlaying}
          selectedClipId={editor.selectedClipId}
          preciseFrame={editor.preciseFrame}
          onPreciseFrameChange={editor.setPreciseFrame}
        />
        <VideoEditorInspector
          clip={editor.selected}
          playheadUs={editor.playheadUs}
          commit={editor.commit}
        />
      </main>
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
                { type: "addTrack", track: newTrack("visual", tracks.length) },
              ])
            }
          >
            <Plus aria-hidden /> 视觉轨
          </button>
          <button
            onClick={() =>
              void editor.commit([
                { type: "addTrack", track: newTrack("audio", tracks.length) },
              ])
            }
          >
            <Plus aria-hidden /> 音频轨
          </button>
        </div>
        <div>
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
        scrollLeft={editor.timelineScrollLeft}
        onScrollLeftChange={editor.setTimelineScrollLeft}
        selectedClipId={editor.selectedClipId}
        selectedClipIds={editor.selectedClipIds}
        selectClip={editor.selectClip}
        commit={editor.commit}
        onDropAsset={(asset, trackId, startUs) =>
          addAsset(asset, startUs, trackId)
        }
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
          selectedClipIds={editor.selectedClipIds}
          onClose={() => setSegmentExportOpen(false)}
        />
      ) : null}
    </div>
  );
}
