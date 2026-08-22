import { X } from "lucide-react";

export function AudioAnnotationTextImportDialog({
  open,
  value,
  error,
  onClose,
  onValueChange,
  onImport,
}: {
  open: boolean;
  value: string;
  error: string;
  onClose: () => void;
  onValueChange: (value: string) => void;
  onImport: () => void;
}) {
  if (!open) return null;
  return (
    <div className="annotation-modal-backdrop" role="presentation">
      <section
        className="annotation-modal annotation-text-import-modal"
        role="dialog"
        aria-modal="true"
        aria-label="导入文本 JSON"
      >
        <header>
          <div>
            <span className="eyebrow">保持片段结构</span>
            <h2>导入文本 JSON</h2>
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
        <p>
          粘贴项目 JSON。只替换原文、附加语言和校对状态；片段
          ID、时间与说话人必须完全一致。
        </p>
        <textarea
          aria-label="项目 JSON"
          value={value}
          placeholder="粘贴导出的项目 JSON…"
          spellCheck={false}
          onChange={(event) => onValueChange(event.target.value)}
        />
        {error ? (
          <p className="annotation-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!value.trim()}
            onClick={onImport}
          >
            载入并保存
          </button>
        </footer>
      </section>
    </div>
  );
}
