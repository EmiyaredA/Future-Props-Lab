import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Save,
  Scissors,
  Users,
} from "lucide-react";
import { LanguageAnnotationEditor } from "./LanguageAnnotationEditor";
import { AudioAnnotationEmotionField } from "./AudioAnnotationEmotionField";
import {
  formatTimestamp,
  parseTimestamp,
  segmentSpeakerIds,
  snapSegmentToNext,
  snapSegmentToPrevious,
  speakerAssignment,
  updateSegmentBounds,
} from "./model";
import type { AnnotationSnapshot, AudioAnnotationDocument } from "./types";
import type { AudioAnnotationEditorController } from "./useAudioAnnotationEditorController";

function snapshot(document: AudioAnnotationDocument): AnnotationSnapshot {
  return {
    schema_version: "1.0",
    speakers: document.speakers,
    segments: document.segments,
  };
}

export function AudioAnnotationSegmentInspector({
  controller,
}: {
  controller: AudioAnnotationEditorController;
}) {
  const {
    canSnapToNext,
    canSnapToPrevious,
    document,
    flushSave,
    mutateSegments,
    nextSegment,
    overlapsNext,
    overlapsPrevious,
    playing,
    preferredDisplayLanguage,
    previewingSegmentId,
    previousSegment,
    project,
    segmentTranscription,
    selected,
    selectedIndex,
    setNotice,
    setSpeakerManager,
    setUndoStack,
    snappedToNext,
    snappedToPrevious,
    speakerById,
    textBase,
    toggleSelectedPreview,
    updateSelected,
  } = controller;
  return (
    <aside className="card annotation-inspector" aria-label="片段编辑器">
      {selected ? (
        <>
          <header>
            <div>
              <span className="eyebrow">当前选择</span>
              <h2>片段 {String(selectedIndex + 1).padStart(2, "0")}</h2>
            </div>
            <span
              style={{
                background: segmentSpeakerIds(selected)[0]
                  ? speakerById.get(segmentSpeakerIds(selected)[0]!)?.color
                  : "#8b9189",
              }}
            />
          </header>
          <div className="annotation-mini-wave">
            <i />
            <button
              type="button"
              className="annotation-segment-preview"
              aria-label={
                playing && previewingSegmentId === selected.id
                  ? "暂停当前片段"
                  : "播放当前片段"
              }
              onClick={toggleSelectedPreview}
            >
              {playing && previewingSegmentId === selected.id ? (
                <Pause aria-hidden />
              ) : (
                <Play aria-hidden />
              )}
              <span>
                {playing && previewingSegmentId === selected.id
                  ? "暂停"
                  : "试听片段"}
              </span>
            </button>
            <span>
              {formatTimestamp(selected.start_ms)} —{" "}
              {formatTimestamp(selected.end_ms)}
            </span>
          </div>
          <div className="annotation-time-fields">
            <label className="annotation-time-field">
              <span>开始</span>
              <input
                key={`${selected.id}-start-${selected.start_ms}`}
                defaultValue={formatTimestamp(selected.start_ms)}
                aria-label="片段开始时间"
                onBlur={(event) => {
                  const parsed = parseTimestamp(event.target.value);
                  if (parsed !== null)
                    mutateSegments(
                      updateSegmentBounds(
                        document.segments,
                        selected.id,
                        parsed,
                        selected.end_ms,
                        project.duration_ms,
                      ),
                    );
                  else setNotice("开始时间格式应为 MM:SS.mmm");
                }}
              />
            </label>
            <span>—</span>
            <label className="annotation-time-field">
              <span>结束</span>
              <input
                key={`${selected.id}-end-${selected.end_ms}`}
                defaultValue={formatTimestamp(selected.end_ms)}
                aria-label="片段结束时间"
                onBlur={(event) => {
                  const parsed = parseTimestamp(event.target.value);
                  if (parsed !== null)
                    mutateSegments(
                      updateSegmentBounds(
                        document.segments,
                        selected.id,
                        selected.start_ms,
                        parsed,
                        project.duration_ms,
                      ),
                    );
                  else setNotice("结束时间格式应为 MM:SS.mmm");
                }}
              />
            </label>
          </div>
          <div className="annotation-time-snap-actions" aria-label="片段衔接">
            <button
              type="button"
              disabled={!canSnapToPrevious}
              title={
                snappedToPrevious
                  ? "当前片段已紧接上一片段"
                  : !previousSegment
                    ? "当前片段没有上一片段"
                    : overlapsPrevious
                      ? "当前片段与上一片段已有重叠"
                      : "将开始时间设为上一片段的结束时间"
              }
              onClick={() =>
                mutateSegments(
                  snapSegmentToPrevious(
                    document.segments,
                    selected.id,
                    project.duration_ms,
                  ),
                )
              }
            >
              <ChevronLeft aria-hidden /> 紧接上一段
            </button>
            <button
              type="button"
              disabled={!canSnapToNext}
              title={
                snappedToNext
                  ? "当前片段已紧接下一片段"
                  : !nextSegment
                    ? "当前片段没有下一片段"
                    : overlapsNext
                      ? "当前片段与下一片段已有重叠"
                      : "将结束时间设为下一片段的开始时间"
              }
              onClick={() =>
                mutateSegments(
                  snapSegmentToNext(
                    document.segments,
                    selected.id,
                    project.duration_ms,
                  ),
                )
              }
            >
              紧接下一段 <ChevronRight aria-hidden />
            </button>
          </div>
          <div className="annotation-inspector-field">
            <span>说话人（可多选）</span>
            <div className="annotation-speaker-field">
              <div
                className="annotation-speaker-options"
                role="group"
                aria-label="选择一个或多个说话人"
              >
                <button
                  type="button"
                  className={
                    segmentSpeakerIds(selected).length ? "" : "selected"
                  }
                  aria-pressed={!segmentSpeakerIds(selected).length}
                  onClick={() =>
                    updateSelected({
                      ...speakerAssignment([]),
                      status: "draft",
                    })
                  }
                >
                  <i style={{ background: "#8b9189" }} />
                  未指定
                </button>
                {document.speakers.map((speaker) => {
                  const selectedSpeakerIds = segmentSpeakerIds(selected);
                  const checked = selectedSpeakerIds.includes(speaker.id);
                  return (
                    <button
                      type="button"
                      key={speaker.id}
                      className={checked ? "selected" : ""}
                      aria-pressed={checked}
                      onClick={() =>
                        updateSelected({
                          ...speakerAssignment(
                            checked
                              ? selectedSpeakerIds.filter(
                                  (speakerId) => speakerId !== speaker.id,
                                )
                              : [...selectedSpeakerIds, speaker.id],
                          ),
                          status: "draft",
                        })
                      }
                    >
                      <i style={{ background: speaker.color }} />
                      <span>{speaker.name}</span>
                      {checked ? <Check aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="annotation-speaker-manage"
                onClick={() => setSpeakerManager(true)}
              >
                <Users aria-hidden /> 管理
              </button>
            </div>
          </div>
          <AudioAnnotationEmotionField
            key={`${selected.id}-emotion`}
            emotion={selected.emotion}
            onChange={(emotion) => updateSelected({ emotion, status: "draft" })}
          />
          <LanguageAnnotationEditor
            key={selected.id}
            segment={selected}
            preferredLanguage={preferredDisplayLanguage}
            onFocus={() => {
              if (!textBase.current) textBase.current = snapshot(document);
            }}
            onChange={(changes, record) =>
              updateSelected(
                {
                  ...changes,
                  status: "draft",
                },
                record,
              )
            }
            onBlur={() => {
              if (textBase.current)
                setUndoStack((current) =>
                  [...current, textBase.current!].slice(-100),
                );
              textBase.current = null;
            }}
            transcription={segmentTranscription.controls}
          />
          <button
            type="button"
            role="checkbox"
            aria-checked={selected.status === "reviewed"}
            className={`annotation-reviewed${selected.status === "reviewed" ? " checked" : ""}`}
            onClick={() =>
              updateSelected({
                status: selected.status === "reviewed" ? "draft" : "reviewed",
              })
            }
          >
            <i>
              {selected.status === "reviewed" ? <Check aria-hidden /> : null}
            </i>
            <span>标记为已校对</span>
          </button>
          <button
            type="button"
            className="btn primary annotation-apply"
            onClick={flushSave}
          >
            <Save aria-hidden /> 应用到片段
          </button>
          <footer>
            <kbd>空格</kbd> 播放/暂停 · <kbd>S</kbd> 切分 · <kbd>⌘Z</kbd> 撤销 ·
            同一片段可维护多个语言版本
          </footer>
        </>
      ) : (
        <div className="annotation-inspector-empty">
          <Scissors aria-hidden />
          <strong>选择一个片段</strong>
          <span>也可以在波形上拖动创建新片段，片段可以重叠。</span>
        </div>
      )}
    </aside>
  );
}
