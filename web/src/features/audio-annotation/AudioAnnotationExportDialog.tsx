import { Download, FileJson, Upload, X } from "lucide-react";
import {
  buildProjectFile,
  buildSrt,
  incompleteSegments,
  safeFileBase,
} from "@features/audio-annotation/model";
import type {
  AudioAnnotationDocument,
  AudioAnnotationProject,
} from "@features/audio-annotation/types";

function downloadBlob(contents: BlobPart[], type: string, filename: string) {
  const url = URL.createObjectURL(new Blob(contents, { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function AudioAnnotationExportDialog({
  open,
  project,
  document,
  onClose,
  onNotice,
}: {
  open: boolean;
  project: AudioAnnotationProject;
  document: AudioAnnotationDocument;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  if (!open) return null;
  const missing = incompleteSegments(document.segments).length;
  const exportJson = () => {
    downloadBlob(
      [
        JSON.stringify(
          buildProjectFile(project, {
            schema_version: "1.0",
            speakers: document.speakers,
            segments: document.segments,
          }),
          null,
          2,
        ),
      ],
      "application/json;charset=utf-8",
      `${safeFileBase(project.title)}.annotation.json`,
    );
  };
  const exportSrt = () => {
    try {
      downloadBlob(
        ["\ufeff", buildSrt(document.segments, document.speakers)],
        "application/x-subrip;charset=utf-8",
        `${safeFileBase(project.title)}.srt`,
      );
      onNotice("");
    } catch (caught) {
      onNotice(caught instanceof Error ? caught.message : "SRT 导出失败");
    }
  };

  return (
    <div className="annotation-modal-backdrop" role="presentation">
      <section
        className="annotation-modal annotation-export-modal"
        role="dialog"
        aria-modal="true"
        aria-label="导出标注"
      >
        <header>
          <div>
            <span className="eyebrow">导出标注</span>
            <h2>选择文件格式</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            <X aria-hidden />
          </button>
        </header>
        <div className="annotation-export-options">
          <button type="button" onClick={exportJson}>
            <FileJson aria-hidden />
            <span>
              <strong>项目 JSON</strong>
              <small>保留说话人、情绪、片段和校对状态，可重新导入。</small>
            </span>
            <Download aria-hidden />
          </button>
          <button type="button" disabled={missing > 0} onClick={exportSrt}>
            <Upload aria-hidden />
            <span>
              <strong>SRT 字幕</strong>
              <small>
                {missing
                  ? `还有 ${missing} 个片段缺少说话人或内容`
                  : "使用“说话人：内容”格式输出字幕。"}
              </small>
            </span>
            <Download aria-hidden />
          </button>
        </div>
      </section>
    </div>
  );
}
