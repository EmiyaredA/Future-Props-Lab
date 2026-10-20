import { containDialogComposition } from "./dialogKeyboard";
import { X, Download } from "lucide-react";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
export function MediaPreview({
  id,
  onClose,
  onDownload,
}: {
  id: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const ref = useDrawerFocus<HTMLDivElement>(onClose, true, false);
  const { url, error } = useApiBlobUrl(
    `/v1/files/${encodeURIComponent(id)}/content`,
  );
  return (
    <div
      className="presentation-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onKeyDownCapture={containDialogComposition}
        ref={ref}
        role="dialog"
        aria-label="原图预览"
        aria-modal="true"
        className="presentation-dialog presentation-original-preview"
      >
        <header>
          <h3>原图预览</h3>
          <button className="btn" onClick={onDownload}>
            <Download size={16} />
            下载原图
          </button>
          <button
            className="icon-btn"
            aria-label="关闭原图预览"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="presentation-dialog-body">
          {error ? (
            <p role="alert">原图加载失败</p>
          ) : url ? (
            <img src={url} alt="原始素材" />
          ) : (
            <p role="status">加载中…</p>
          )}
        </div>
      </div>
    </div>
  );
}
