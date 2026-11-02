import { LoadingState } from "@shared/ui/LoadingState";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { RefreshCw, TriangleAlert, X } from "lucide-react";
import { createPortal } from "react-dom";
import "@shared/ui/confirm-dialog.css";

export function ConfirmDialog({
  open,
  className = "",
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "danger",
  pending = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  className?: string;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  pending?: boolean;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const confirmButton = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
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
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!pendingRef.current) cancelRef.current();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ) || [],
        ).filter(
          (node) =>
            node.getClientRects().length &&
            getComputedStyle(node).visibility !== "hidden",
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (!dialogRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const frame = requestAnimationFrame(() => {
      const target = confirmButton.current?.disabled
        ? dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)")
        : confirmButton.current;
      target?.focus({ preventScroll: true });
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(frame);
      if (ownsScrollLock) document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected)
        previouslyFocused.focus({ preventScroll: true });
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
        ref={dialogRef}
        className={`modal-card confirm-dialog ${className}`}
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
        <span className={`confirm-dialog-icon ${tone}`}>
          {tone === "primary" ? (
            <RefreshCw aria-hidden />
          ) : (
            <TriangleAlert aria-hidden />
          )}
        </span>
        <div className="confirm-dialog-copy">
          <span className="eyebrow">请确认操作</span>
          <h2 id={titleId}>{title}</h2>
          <div className="confirm-dialog-description" id={descriptionId}>
            {description}
          </div>
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
            className={`btn ${tone}`}
            disabled={pending || confirmDisabled}
            onClick={() => void onConfirm()}
          >
            {pending ? (
              <LoadingState variant="inline" label="处理中…" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
