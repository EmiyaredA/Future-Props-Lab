import { LoadingState } from "@shared/ui/LoadingState";
import { useEffect, useId, useRef } from "react";
import { TriangleAlert, X } from "lucide-react";
import { createPortal } from "react-dom";
import "@shared/ui/confirm-dialog.css";
import "./knowledge-tree.css";

export function DeleteDocumentDialog({
  open,
  title,
  pending = false,
  onCancel,
  onDeleteSelf,
  onDeleteSubtree,
}: {
  open: boolean;
  title: string;
  pending?: boolean;
  onCancel: () => void;
  onDeleteSelf: () => void | Promise<void>;
  onDeleteSubtree: () => void | Promise<void>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const firstAction = useRef<HTMLButtonElement>(null);
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
    requestAnimationFrame(() => firstAction.current?.focus());
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
        className="modal-card confirm-dialog knowledge-delete-dialog"
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
          <h2 id={titleId}>删除「{title}」？</h2>
          <p id={descriptionId}>
            该文档下还有子文档。你可以只删除当前文档（子文档上移到上一级），或连同全部子文档一起移入回收站。
          </p>
        </div>
        <div className="modal-actions knowledge-delete-actions">
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            ref={firstAction}
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => void onDeleteSelf()}
          >
            {pending ? (
              <LoadingState variant="inline" label="处理中…" />
            ) : (
              "仅删除此文档"
            )}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={pending}
            onClick={() => void onDeleteSubtree()}
          >
            {pending ? (
              <LoadingState variant="inline" label="处理中…" />
            ) : (
              "删除此文档及子文档"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
