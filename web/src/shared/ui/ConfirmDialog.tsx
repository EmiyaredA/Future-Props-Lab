import { useEffect, useId, useRef, type ReactNode } from "react";
import { TriangleAlert, X } from "lucide-react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  pending = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  const pendingRef = useRef(pending);
  cancelRef.current = onCancel;
  pendingRef.current = pending;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const ownsScrollLock = previousOverflow !== "hidden";
    if (ownsScrollLock) document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingRef.current) cancelRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => confirmButton.current?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (ownsScrollLock) document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        className="modal-card confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <button
          type="button"
          className="icon-btn confirm-dialog-close"
          aria-label="关闭确认弹窗"
          disabled={pending}
          onClick={onCancel}
        >
          <X aria-hidden />
        </button>
        <span className="confirm-dialog-icon">
          <TriangleAlert aria-hidden />
        </span>
        <div className="confirm-dialog-copy">
          <span className="eyebrow">请确认操作</span>
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButton}
            type="button"
            className="btn danger"
            disabled={pending}
            onClick={() => void onConfirm()}
          >
            {pending ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
