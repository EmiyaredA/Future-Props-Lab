import { useEffect, useState } from "react";
import { CompactPanelTabs } from "@shared/ui/CompactPanelTabs";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Merge,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  Search,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  ANNOTATION_LANGUAGES,
  createSegment,
  formatDuration,
  formatTimestamp,
  languageColor,
  languageLabel,
  segmentSpeakerIds,
  segmentSpeakerEmotions,
  segmentLanguageCodes,
  segmentDisplayText,
  PRIMARY_DISPLAY_LANGUAGE,
  storePreferredDisplayLanguage,
  updateSegmentBounds,
  waveformFocusZoom,
  WAVEFORM_ZOOM_RATIOS,
} from "@features/audio-annotation/model";
import type { AudioAnnotationSpeaker } from "@features/audio-annotation/types";
import { AudioWaveform } from "@features/audio-annotation/AudioWaveform";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { AudioAnnotationEditorDialogs } from "./AudioAnnotationEditorDialogs";
import type { SpeakerImportSource } from "./speakerImportSource";
import { AudioAnnotationSegmentInspector } from "./AudioAnnotationSegmentInspector";
import { useAudioAnnotationEditorController } from "./useAudioAnnotationEditorController";
import "@features/audio-annotation/audio-annotation-import.css";
import "@features/audio-annotation/audio-annotation.css";
import "@features/audio-annotation/audio-annotation-responsive.css";
import "./audio-annotation-compact.css";

function AmadeusAudioContext({
  projectId,
  title,
  selectedId,
  selectedText,
  dirty,
}: {
  projectId: string;
  title: string;
  selectedId?: string;
  selectedText?: string;
  dirty: boolean;
}) {
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("future-props:amadeus-context", {
        detail: {
          application: "音频标注工坊",
          projectId,
          title,
          selection: selectedId
            ? {
                id: selectedId,
                name: "标注片段",
                value: selectedText?.slice(0, 160) || "",
              }
            : undefined,
          unsaved: dirty,
        },
      }),
    );
  }, [projectId, title, selectedId, selectedText, dirty]);
  return null;
}

export function AudioAnnotationEditorPage({
  projectId,
  workspaceId,
  onBack,
  registerNavigationGuard,
  speakerImportSource,
}: {
  projectId: string;
  workspaceId: string;
  onBack: () => void;
  registerNavigationGuard: (
    guard: ((continueNavigation: () => void) => boolean) | null,
  ) => void;
  speakerImportSource?: SpeakerImportSource;
}) {
  const [mobilePanel, setMobilePanel] = useState("waveform");
  const [regionFlashToken, setRegionFlashToken] = useState(0);
  const controller = useAudioAnnotationEditorController({
    projectId,
    workspaceId,
    onBack,
    registerNavigationGuard,
  });
  if (controller.status === "error")
    return (
      <section
        className="page annotation-editor-page"
        data-mobile-panel={mobilePanel}
      >
        <p className="annotation-error">任务加载失败，请返回后重试。</p>
        <button type="button" className="btn" onClick={controller.onBack}>
          返回任务列表
        </button>
      </section>
    );
  if (controller.status === "loading")
    return (
      <section
        className="page annotation-editor-page"
        data-mobile-panel={mobilePanel}
      >
        <div className="page-loading">正在加载录音标注任务…</div>
      </section>
    );
  const {
    addOverlappingSegment,
    applyZoom,
    conflict,
    currentMs,
    dirty,
    doMerge,
    doSplit,
    document,
    flushSave,
    focusSelectionMode,
    languageFilter,
    maxViewportStartMs,
    mutateSegments,
    nextSegment,
    notice,
    playing,
    preferredDisplayLanguage,
    previewingSegmentId,
    project,
    rate,
    redo,
    redoStack,
    reloadServer,
    save,
    saveLabel,
    savePeaks,
    search,
    segmentTranscription,
    selected,
    selectedId,
    selectedIndex,
    setConfirmLeave,
    setCurrentMs,
    setExportOpen,
    setFocusSelectionMode,
    setLanguageFilter,
    setNotice,
    setPlaying,
    setPreferredDisplayLanguage,
    setPreviewingSegmentId,
    setRate,
    setSearch,
    setSelectedId,
    setStatusFilter,
    setTextImportError,
    setTextImportOpen,
    setTextImportValue,
    setVolume,
    setWaveformViewport,
    setZoomRatio,
    speakerById,
    statusFilter,
    undo,
    undoStack,
    visibleSegments,
    volume,
    waveform,
    waveformRef,
    waveformViewport,
    zoomRatio,
  } = controller;
  return (
    <section
      className="page annotation-editor-page"
      data-mobile-panel={mobilePanel}
    >
      <AmadeusAudioContext
        projectId={projectId}
        title={project.title}
        selectedId={selectedId ?? undefined}
        selectedText={selected?.text}
        dirty={dirty || save.isPending || Boolean(conflict)}
      />
      <header className="annotation-editor-header">
        <div className="annotation-editor-title">
          <button
            type="button"
            className="annotation-back-square"
            aria-label="返回任务列表"
            onClick={() => (dirty ? setConfirmLeave(true) : onBack())}
          >
            <ArrowLeft aria-hidden />
          </button>
          <div>
            <h1>{project.title}</h1>
            <p>
              {project.original_filename} · {saveLabel}
            </p>
          </div>
        </div>
        <div className="annotation-editor-actions">
          {window.futurePropsDesktop?.openAmadeus && (
            <button
              type="button"
              className="btn"
              onClick={() => void window.futurePropsDesktop?.openAmadeus?.()}
            >
              ✦ Amadeus
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTextImportValue("");
              setTextImportError("");
              setTextImportOpen(true);
            }}
          >
            <Upload aria-hidden /> 导入文本 JSON
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setExportOpen(true)}
          >
            <Download aria-hidden /> 导出标注
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!dirty || save.isPending || conflict}
            onClick={flushSave}
          >
            <Save aria-hidden /> 保存
          </button>
        </div>
      </header>
      {notice ? (
        <p className="annotation-error" role="alert">
          {notice}
        </p>
      ) : null}
      {conflict ? (
        <div className="annotation-conflict" role="alert">
          <span>服务器上的标注已被其他操作更新。本地内容不会被自动覆盖。</span>
          <button type="button" onClick={() => setExportOpen(true)}>
            导出本地 JSON
          </button>
          <button type="button" onClick={() => void reloadServer()}>
            加载服务器版本
          </button>
        </div>
      ) : null}

      <CompactPanelTabs
        label="录音标注面板"
        value={mobilePanel}
        onChange={setMobilePanel}
        options={[
          { value: "waveform", label: "波形与片段" },
          { value: "inspector", label: "编辑片段" },
        ]}
      />
      <div className="annotation-editor-grid">
        <div className="annotation-editor-main">
          <section className="card annotation-waveform-card">
            <header className="annotation-waveform-meta">
              <div>
                <small>音频总时长</small>
                <strong>{formatDuration(project.duration_ms)}</strong>
              </div>
              <div>
                <small>文件信息</small>
                <span>
                  {project.mime_type.replace("audio/", "").toUpperCase()} ·{" "}
                  {(project.byte_size / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
              <div className="annotation-waveform-tools">
                <div className="annotation-zoom-controls">
                  <button
                    type="button"
                    aria-label="缩小波形"
                    disabled={zoomRatio <= 1}
                    onClick={() => applyZoom(zoomRatio / 2)}
                  >
                    <ZoomOut aria-hidden />
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="8"
                    step="0.05"
                    value={Math.log2(zoomRatio)}
                    aria-label="波形缩放比例"
                    onChange={(event) =>
                      applyZoom(2 ** Number(event.target.value))
                    }
                  />
                  <span>{zoomRatio.toFixed(zoomRatio < 10 ? 1 : 0)}×</span>
                  <button
                    type="button"
                    aria-label="放大波形"
                    disabled={zoomRatio >= WAVEFORM_ZOOM_RATIOS.at(-1)!}
                    onClick={() => applyZoom(zoomRatio * 2)}
                  >
                    <ZoomIn aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  className="annotation-view-action"
                  disabled={zoomRatio === 1}
                  onClick={() => applyZoom(1, 0)}
                >
                  适应全长
                </button>
                <button
                  type="button"
                  className="annotation-view-action"
                  disabled={!selected}
                  onClick={() => {
                    if (!selected) return;
                    const next = waveformFocusZoom(
                      project.duration_ms,
                      selected.start_ms,
                      selected.end_ms,
                    );
                    applyZoom(next, (selected.start_ms + selected.end_ms) / 2);
                  }}
                >
                  聚焦所选
                </button>
                <button
                  type="button"
                  className="annotation-view-action"
                  aria-pressed={focusSelectionMode}
                  onClick={() => {
                    const next = !focusSelectionMode;
                    waveformRef.current?.setFocusSelectionMode(next);
                    setFocusSelectionMode(next);
                    if (next) applyZoom(1, 0);
                  }}
                >
                  {focusSelectionMode ? "取消框选" : "框选放大"}
                </button>
              </div>
            </header>
            <AudioWaveform
              ref={waveformRef}
              assetId={project.asset_id}
              durationMs={project.duration_ms}
              peaks={waveform.peaks}
              segments={document.segments}
              speakers={document.speakers}
              selectedId={selectedId}
              flashToken={regionFlashToken}
              focusSelectionMode={focusSelectionMode}
              onSelect={(segmentId) => {
                if (previewingSegmentId) waveformRef.current?.pause();
                setPreviewingSegmentId(null);
                setSelectedId(segmentId);
              }}
              onUpdate={(id, start, end) =>
                mutateSegments(
                  updateSegmentBounds(
                    document.segments,
                    id,
                    start,
                    end,
                    project.duration_ms,
                  ),
                )
              }
              onCreate={(start, end) =>
                mutateSegments(createSegment(document.segments, start, end))
              }
              onTime={setCurrentMs}
              onPlayState={(nextPlaying) => {
                setPlaying(nextPlaying);
                if (!nextPlaying) setPreviewingSegmentId(null);
              }}
              onViewport={setWaveformViewport}
              onFocusRange={(startMs, endMs) => {
                const next = waveformFocusZoom(
                  project.duration_ms,
                  startMs,
                  endMs,
                );
                waveformRef.current?.setFocusSelectionMode(false);
                setFocusSelectionMode(false);
                setZoomRatio(next);
                waveformRef.current?.zoom(next, (startMs + endMs) / 2);
              }}
              onReadyPeaks={(peaks) => {
                if (!waveform.peaks.length && !savePeaks.isPending)
                  savePeaks.mutate(peaks);
              }}
              onAudioReady={segmentTranscription.setAudioReady}
              onError={setNotice}
            />
            <div className="annotation-waveform-navigator">
              <button
                type="button"
                aria-label="向左浏览波形"
                disabled={zoomRatio === 1 || waveformViewport.startMs <= 0}
                onClick={() => waveformRef.current?.panBy(-0.8)}
              >
                <ChevronLeft aria-hidden />
              </button>
              <label>
                <span>左右浏览</span>
                <input
                  type="range"
                  min="0"
                  max={maxViewportStartMs}
                  step="100"
                  value={Math.min(maxViewportStartMs, waveformViewport.startMs)}
                  aria-label="波形浏览位置"
                  disabled={zoomRatio === 1}
                  onChange={(event) =>
                    waveformRef.current?.scrollTo(Number(event.target.value))
                  }
                />
              </label>
              <button
                type="button"
                aria-label="向右浏览波形"
                disabled={
                  zoomRatio === 1 ||
                  waveformViewport.startMs >= maxViewportStartMs
                }
                onClick={() => waveformRef.current?.panBy(0.8)}
              >
                <ChevronRight aria-hidden />
              </button>
              <span className="annotation-viewport-time">
                当前窗口 {formatTimestamp(waveformViewport.startMs)} –{" "}
                {formatTimestamp(waveformViewport.endMs || project.duration_ms)}
              </span>
              <small>拖动滑杆，或在波形上横向滚动</small>
            </div>
            <div className="annotation-transport">
              <button
                type="button"
                className="annotation-play"
                aria-label={playing ? "暂停录音" : "播放录音"}
                onClick={() => waveformRef.current?.playPause()}
              >
                {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
              </button>
              <CustomSelect
                ariaLabel="播放速度"
                value={rate}
                options={[
                  { value: "0.5", label: "0.5×" },
                  { value: "0.75", label: "0.75×" },
                  { value: "1", label: "1.0×" },
                  { value: "1.25", label: "1.25×" },
                  { value: "1.5", label: "1.5×" },
                  { value: "2", label: "2.0×" },
                ]}
                onChange={(value) => {
                  setRate(value);
                  waveformRef.current?.setRate(Number(value));
                }}
              />
              <div className="annotation-playback-time">
                <strong>{formatTimestamp(currentMs)}</strong>
                <span>/ {formatTimestamp(project.duration_ms)}</span>
              </div>
              <label className="annotation-volume">
                <Volume2 aria-hidden />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  aria-label="录音音量"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setVolume(next);
                    waveformRef.current?.setVolume(next);
                  }}
                />
              </label>
              <div className="annotation-edit-actions">
                <button
                  type="button"
                  aria-label="在此切分"
                  title="在此切分"
                  disabled={!selected}
                  onClick={doSplit}
                >
                  <Scissors aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="添加重叠片段"
                  title="添加重叠片段"
                  disabled={!selected}
                  onClick={addOverlappingSegment}
                >
                  <Plus aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="合并下一段"
                  title="合并下一段"
                  disabled={!selected || !nextSegment}
                  onClick={doMerge}
                >
                  <Merge aria-hidden />
                </button>
                <button
                  type="button"
                  className="danger"
                  aria-label="删除片段"
                  title="删除片段"
                  disabled={!selected}
                  onClick={() => {
                    if (!selected) return;
                    mutateSegments(
                      document.segments.filter(
                        (segment) => segment.id !== selected.id,
                      ),
                    );
                    setSelectedId(
                      nextSegment?.id ??
                        document.segments[selectedIndex - 1]?.id ??
                        null,
                    );
                  }}
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
            </div>
          </section>

          <section className="card annotation-segment-table-card">
            <header>
              <label>
                <Search aria-hidden />
                <input
                  aria-label="搜索片段内容"
                  placeholder="搜索片段内容…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <CustomSelect
                ariaLabel="优先展示语言"
                className="annotation-display-language"
                value={preferredDisplayLanguage}
                options={[
                  { value: PRIMARY_DISPLAY_LANGUAGE, label: "原文优先" },
                  ...ANNOTATION_LANGUAGES.map((language) => ({
                    value: language.code,
                    label: `${language.label}优先`,
                  })),
                ]}
                onChange={(language) => {
                  setPreferredDisplayLanguage(language);
                  storePreferredDisplayLanguage(
                    projectId,
                    language,
                    window.localStorage,
                  );
                }}
              />
              <CustomSelect
                ariaLabel="筛选片段语言"
                value={languageFilter}
                options={[
                  { value: "all", label: "全部语言" },
                  ...ANNOTATION_LANGUAGES.map((language) => ({
                    value: language.code,
                    label: language.label,
                  })),
                  { value: "unlabeled", label: "未标注语言" },
                ]}
                onChange={setLanguageFilter}
              />
              <CustomSelect
                ariaLabel="筛选片段状态"
                value={statusFilter}
                options={[
                  { value: "all", label: "全部状态" },
                  { value: "reviewed", label: "已校对" },
                  { value: "draft", label: "待校对" },
                ]}
                onChange={setStatusFilter}
              />
              <div className="annotation-history">
                <button
                  type="button"
                  aria-label="撤销"
                  disabled={!undoStack.length}
                  onClick={undo}
                >
                  <Undo2 aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="重做"
                  disabled={!redoStack.length}
                  onClick={redo}
                >
                  <Redo2 aria-hidden />
                </button>
              </div>
            </header>
            <div
              className="annotation-segment-table"
              role="table"
              aria-label="音频片段列表"
            >
              <div role="row" className="annotation-segment-head">
                <span>片段</span>
                <span>时间范围</span>
                <span>说话人</span>
                <span>情绪</span>
                <span>语言</span>
                <span>内容</span>
                <span>状态</span>
              </div>
              {visibleSegments.map((segment) => {
                const index = document.segments.findIndex(
                  (item) => item.id === segment.id,
                );
                const segmentSpeakers = segmentSpeakerIds(segment)
                  .map((speakerId) => speakerById.get(speakerId))
                  .filter(
                    (speaker): speaker is AudioAnnotationSpeaker =>
                      speaker !== undefined,
                  );
                const languageCodes = segmentLanguageCodes(segment);
                return (
                  <button
                    type="button"
                    role="row"
                    key={segment.id}
                    data-amadeus-id={segment.id}
                    data-amadeus-name="标注片段"
                    data-amadeus-value={`${formatTimestamp(segment.start_ms)} – ${formatTimestamp(segment.end_ms)}`}
                    className={selectedId === segment.id ? "selected" : ""}
                    onClick={() => {
                      if (previewingSegmentId) waveformRef.current?.pause();
                      setPreviewingSegmentId(null);
                      setSelectedId(segment.id);
                      setRegionFlashToken((token) => token + 1);
                      waveformRef.current?.seekMs(segment.start_ms);
                    }}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span>
                      {formatTimestamp(segment.start_ms)} –{" "}
                      {formatTimestamp(segment.end_ms)}
                    </span>
                    <span className="annotation-segment-speakers">
                      <span className="annotation-speaker-dots" aria-hidden>
                        {segmentSpeakers.length ? (
                          segmentSpeakers.map((item) => (
                            <i
                              key={item.id}
                              style={{ background: item.color }}
                            />
                          ))
                        ) : (
                          <i style={{ background: "#8b9189" }} />
                        )}
                      </span>
                      <span className="annotation-segment-speaker-names">
                        {segmentSpeakers.length
                          ? segmentSpeakers.map((item) => item.name).join("、")
                          : "未指定"}
                      </span>
                    </span>
                    <span className="annotation-segment-emotion">
                      {(() => {
                        const emotions = segmentSpeakerEmotions(segment);
                        if (!emotions.length) return <em>未标注</em>;
                        return emotions.map((item) => {
                          const speaker = speakerById.get(item.speaker_id);
                          return (
                            <i key={item.speaker_id}>
                              <b
                                style={{
                                  background: speaker?.color ?? "#8b9189",
                                }}
                                aria-hidden
                              />
                              {item.emotion}
                            </i>
                          );
                        });
                      })()}
                    </span>
                    <span className="annotation-language-badges">
                      {languageCodes.length ? (
                        languageCodes.map((code) => (
                          <i
                            key={code}
                            className={`language-${languageColor(code)}`}
                          >
                            {languageLabel(code)}
                          </i>
                        ))
                      ) : (
                        <em>未标注</em>
                      )}
                    </span>
                    <span>
                      {segmentDisplayText(segment, preferredDisplayLanguage) ||
                        "（尚未填写内容）"}
                    </span>
                    <span className={segment.status}>
                      {segment.status === "reviewed" ? "已校对" : "待校对"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <AudioAnnotationSegmentInspector controller={controller} />
      </div>

      <AudioAnnotationEditorDialogs
        controller={controller}
        speakerImportSource={speakerImportSource}
      />
    </section>
  );
}
