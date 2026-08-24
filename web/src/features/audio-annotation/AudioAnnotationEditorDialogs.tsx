import { X } from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { AudioAnnotationExportDialog } from "./AudioAnnotationExportDialog";
import { AudioAnnotationSpeakerManager } from "./AudioAnnotationSpeakerManager";
import { AudioAnnotationTextImportDialog } from "./AudioAnnotationTextImportDialog";
import { SegmentTranscriptionDialogs } from "./SegmentTranscriptionDialogs";
import {
  mergeImportedSpeakers,
  mergeWithNext,
  prepareTextOnlyAnnotationImport,
  segmentSpeakerIds,
  speakerAssignment,
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

export function AudioAnnotationEditorDialogs({
  controller,
}: {
  controller: AudioAnnotationEditorController;
}) {
  const {
    applySnapshot,
    confirmLeave,
    confirmMerge,
    deleteSpeaker,
    deleteSpeakerReplacement,
    document,
    exportOpen,
    mutateSegments,
    onBack,
    pendingNavigation,
    project,
    registerNavigationGuard,
    segmentTranscription,
    selected,
    setConfirmLeave,
    setConfirmMerge,
    setDeleteSpeaker,
    setDeleteSpeakerReplacement,
    setDirty,
    setExportOpen,
    setNotice,
    setPendingNavigation,
    setSpeakerManager,
    setTextImportError,
    setTextImportOpen,
    setTextImportValue,
    speakerManager,
    textImportError,
    textImportOpen,
    textImportValue,
  } = controller;
  return (
    <>
      <AudioAnnotationSpeakerManager
        open={speakerManager}
        projectTitle={project.title}
        speakers={document.speakers}
        onClose={() => setSpeakerManager(false)}
        onChange={(speakers) =>
          applySnapshot({ ...snapshot(document), speakers })
        }
        onImport={(imported) => {
          const speakers = mergeImportedSpeakers(document.speakers, imported);
          applySnapshot({ ...snapshot(document), speakers });
          return speakers.length - document.speakers.length;
        }}
        onDelete={(speaker) => {
          setDeleteSpeakerReplacement("unassigned");
          setDeleteSpeaker(speaker);
        }}
      />
      {deleteSpeaker ? (
        <div className="annotation-modal-backdrop" role="presentation">
          <section
            className="annotation-modal annotation-delete-speaker-modal"
            role="dialog"
            aria-modal="true"
            aria-label="删除说话人"
          >
            <header>
              <div>
                <span className="eyebrow">删除说话人</span>
                <h2>重新分配“{deleteSpeaker.name}”的片段</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭"
                onClick={() => setDeleteSpeaker(null)}
              >
                <X aria-hidden />
              </button>
            </header>
            <p>
              选择替代说话人，或将相关片段设为未指定；这些片段会恢复为待校对。
            </p>
            <CustomSelect
              ariaLabel="删除后的替代说话人"
              value={deleteSpeakerReplacement}
              options={[
                { value: "unassigned", label: "设为未指定" },
                ...document.speakers
                  .filter((speaker) => speaker.id !== deleteSpeaker.id)
                  .map((speaker) => ({
                    value: speaker.id,
                    label: `替换为 ${speaker.name}`,
                  })),
              ]}
              onChange={setDeleteSpeakerReplacement}
            />
            <footer>
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteSpeaker(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  applySnapshot({
                    schema_version: "1.0",
                    speakers: document.speakers.filter(
                      (speaker) => speaker.id !== deleteSpeaker.id,
                    ),
                    segments: document.segments.map((segment) => {
                      const speakerIds = segmentSpeakerIds(segment);
                      if (!speakerIds.includes(deleteSpeaker.id))
                        return segment;
                      const replacement =
                        deleteSpeakerReplacement === "unassigned"
                          ? []
                          : [deleteSpeakerReplacement];
                      return {
                        ...segment,
                        ...speakerAssignment(
                          speakerIds.flatMap((speakerId) =>
                            speakerId === deleteSpeaker.id
                              ? replacement
                              : [speakerId],
                          ),
                        ),
                        status: "draft",
                      };
                    }),
                  });
                  setDeleteSpeaker(null);
                }}
              >
                删除并重新分配
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      <SegmentTranscriptionDialogs controller={segmentTranscription} />
      <ConfirmDialog
        open={confirmMerge}
        title="合并不同说话人的片段？"
        description="合并后将保留当前片段的说话人，两个片段的文本会以换行连接。"
        confirmLabel="继续合并"
        onCancel={() => setConfirmMerge(false)}
        onConfirm={() => {
          if (selected)
            mutateSegments(mergeWithNext(document.segments, selected.id));
          setConfirmMerge(false);
        }}
      />
      <ConfirmDialog
        open={confirmLeave || Boolean(pendingNavigation)}
        title="离开并放弃未保存内容？"
        description="当前还有尚未保存到 Workspace 的修改。"
        confirmLabel="放弃并离开"
        onCancel={() => {
          setConfirmLeave(false);
          setPendingNavigation(null);
        }}
        onConfirm={() => {
          registerNavigationGuard(null);
          setDirty(false);
          setConfirmLeave(false);
          const continueNavigation = pendingNavigation;
          setPendingNavigation(null);
          if (continueNavigation) continueNavigation();
          else onBack();
        }}
      />
      <AudioAnnotationExportDialog
        open={exportOpen}
        project={project}
        document={document}
        onClose={() => setExportOpen(false)}
        onNotice={setNotice}
      />
      <AudioAnnotationTextImportDialog
        open={textImportOpen}
        value={textImportValue}
        error={textImportError}
        onClose={() => setTextImportOpen(false)}
        onValueChange={(value) => {
          setTextImportValue(value);
          setTextImportError("");
        }}
        onImport={() => {
          try {
            const next = prepareTextOnlyAnnotationImport(
              snapshot(document),
              JSON.parse(textImportValue) as unknown,
            );
            applySnapshot(next);
            setTextImportOpen(false);
            setTextImportValue("");
            setNotice("文本已载入，正在通过版本校验保存…");
          } catch (error) {
            setTextImportError(
              error instanceof Error ? error.message : "JSON 解析失败",
            );
          }
        }}
      />
    </>
  );
}
