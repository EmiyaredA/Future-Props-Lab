import { AlertTriangle, FileText, X } from "lucide-react";
import { useState } from "react";
import { formatTime } from "./editorModel";
import type { SubtitleParseResult, SubtitleTimingMode } from "./subtitleImport";

export function VideoEditorSubtitleImportDialog({
  fileName,
  result,
  error,
  pending = false,
  onCancel,
  onConfirm,
}: {
  fileName: string;
  result?: SubtitleParseResult;
  error?: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (mode: SubtitleTimingMode) => void;
}) {
  const [firstCue] = result?.cues ?? [];
  const [lastCue] = result?.cues.slice(-1) ?? [];
  const canImport = Boolean(result?.cues.length) && !pending;
  const [mode, setMode] = useState<SubtitleTimingMode>("original");

  return (
    <div className="ve-dialog-backdrop">
      <section
        className="ve-dialog ve-subtitle-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ve-subtitle-import-title"
      >
        <header>
          <div>
            <FileText aria-hidden />
            <div>
              <h2 id="ve-subtitle-import-title">导入字幕</h2>
              <p>{fileName}</p>
            </div>
          </div>
          <button
            type="button"
            className="ve-dialog-close"
            aria-label="关闭字幕导入"
            onClick={onCancel}
            disabled={pending}
          >
            <X aria-hidden />
          </button>
        </header>
        {error ? (
          <p role="alert" className="ve-subtitle-error">
            {error}
          </p>
        ) : null}
        {result ? (
          <>
            <div className="ve-subtitle-summary">
              <span>格式：{result.format.toUpperCase()}</span>
              <span>有效字幕：{result.cues.length} 条</span>
              <span>跳过：{result.skippedCount} 条</span>
              {firstCue && lastCue ? (
                <span>
                  时间：{formatTime(firstCue.startUs)} –{" "}
                  {formatTime(lastCue.endUs)}
                </span>
              ) : null}
            </div>
            {result.warnings.length ? (
              <div className="ve-subtitle-warnings" role="status">
                <strong>
                  <AlertTriangle aria-hidden /> 已发现 {result.warnings.length}{" "}
                  个问题
                </strong>
                <ul>
                  {result.warnings.slice(0, 8).map((item, index) => (
                    <li key={`${item.line}-${index}`}>
                      第 {item.line} 行：{item.message}
                    </li>
                  ))}
                </ul>
                {result.warnings.length > 8 ? (
                  <small>其余问题将在导入时按相同规则跳过。</small>
                ) : null}
              </div>
            ) : null}
            <fieldset className="ve-subtitle-timing" disabled={pending}>
              <legend>时间码处理</legend>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "original"}
                className={mode === "original" ? "selected" : ""}
                onClick={() => setMode("original")}
              >
                <strong>保留原始时间码</strong>
                <small>按字幕文件中的绝对时间放置。</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === "playhead"}
                className={mode === "playhead" ? "selected" : ""}
                onClick={() => setMode("playhead")}
              >
                <strong>首条字幕对齐当前播放头</strong>
                <small>整体平移字幕，不改变各条之间的间隔。</small>
              </button>
            </fieldset>
          </>
        ) : null}
        <footer>
          <button type="button" onClick={onCancel} disabled={pending}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canImport}
            onClick={() => onConfirm(mode)}
          >
            {pending ? "导入中…" : `导入 ${result?.cues.length ?? 0} 条字幕`}
          </button>
        </footer>
      </section>
    </div>
  );
}
