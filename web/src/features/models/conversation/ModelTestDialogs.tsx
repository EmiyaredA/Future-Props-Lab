import { X } from "lucide-react";
import type { ModelTestConversationSummary } from "@features/models/api";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";

export function ModelTestDialogs({
  error,
  attachment,
  deleteTarget,
  deleting,
  deleteError,
  onCloseError,
  onCloseAttachment,
  onCancelDelete,
  onDelete,
}: {
  error: string | null;
  attachment: { url: string; name: string } | null;
  deleteTarget: ModelTestConversationSummary | null;
  deleting: boolean;
  deleteError: string;
  onCloseError: () => void;
  onCloseAttachment: () => void;
  onCancelDelete: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <>
      {error ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && onCloseError()
          }
        >
          <div
            className="modal-card error-detail-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">调用错误</span>
                <h2>错误详情</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭错误详情"
                onClick={onCloseError}
              >
                <X aria-hidden />
              </button>
            </div>
            <pre>{error}</pre>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => void navigator.clipboard.writeText(error)}
              >
                复制完整错误
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={onCloseError}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {attachment ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && onCloseAttachment()
          }
        >
          <div
            className="modal-card attachment-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`图片预览 ${attachment.name}`}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">图片附件</span>
                <h2>{attachment.name}</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭图片预览"
                onClick={onCloseAttachment}
              >
                <X aria-hidden />
              </button>
            </div>
            <div className="attachment-preview-stage">
              <img src={attachment.url} alt={attachment.name} />
            </div>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除测试对话"
        description={
          <>
            {deleteTarget
              ? `对话「${deleteTarget.title}」及其中的全部消息将被永久删除。`
              : ""}
            {deleteError && (
              <p role="alert" className="danger-text">
                {deleteError}
              </p>
            )}
          </>
        }
        confirmLabel="删除对话"
        pending={deleting}
        onCancel={onCancelDelete}
        onConfirm={onDelete}
      />
    </>
  );
}
