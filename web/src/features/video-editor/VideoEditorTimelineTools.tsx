import {
  ClipboardPaste,
  Copy,
  Magnet,
  ScanSearch,
  Scissors,
  Trash2,
} from "lucide-react";
import { formatTime } from "./editorModel";

export function VideoEditorTimelineTools({
  playheadUs,
  hasSelection,
  canCopy,
  canPaste,
  snapEnabled,
  onSplit,
  onCopy,
  onPaste,
  onDelete,
  onRippleDelete,
  onToggleSnap,
  onCheckGaps,
}: {
  playheadUs: number;
  hasSelection: boolean;
  canCopy: boolean;
  canPaste: boolean;
  snapEnabled: boolean;
  onSplit: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onRippleDelete: () => void;
  onToggleSnap: () => void;
  onCheckGaps?: () => void;
}) {
  return (
    <header className="ve-timeline-tools">
      <strong>时间轴</strong>
      <span>{formatTime(playheadUs)}</span>
      <button disabled={!hasSelection} onClick={onSplit}>
        <Scissors aria-hidden /> 分割
      </button>
      <button disabled={!hasSelection || !canCopy} onClick={onCopy}>
        <Copy aria-hidden /> 复制
      </button>
      <button disabled={!canPaste} onClick={onPaste}>
        <ClipboardPaste aria-hidden /> 粘贴
      </button>
      <button disabled={!hasSelection} onClick={onDelete}>
        <Trash2 aria-hidden /> 删除
      </button>
      <button disabled={!hasSelection} onClick={onRippleDelete}>
        波纹删除
      </button>
      <button
        className={`ve-snap-toggle${snapEnabled ? " active" : ""}`}
        aria-pressed={snapEnabled}
        onClick={onToggleSnap}
        title={
          snapEnabled ? "关闭片段接缝与跨轨边吸附" : "开启片段接缝与跨轨边吸附"
        }
      >
        <Magnet aria-hidden /> {snapEnabled ? "吸附" : "吸附关闭"}
      </button>
      {onCheckGaps ? (
        <button onClick={onCheckGaps}>
          <ScanSearch aria-hidden /> 检查空隙
        </button>
      ) : null}
    </header>
  );
}
