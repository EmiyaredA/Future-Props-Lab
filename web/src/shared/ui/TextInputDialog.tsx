import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import "@shared/ui/text-input-dialog.css";

export function TextInputDialog({
  open,
  title,
  label,
  initialValue = "",
  confirmLabel = "确认",
  cancelLabel = "取消",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(onCancel);
  const [value, setValue] = useState(initialValue);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    setValue(initialValue);
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRef.current();
    };
    window.addEventListener("keydown", close);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", close);
      previouslyFocused?.focus();
    };
  }, [initialValue, open]);

  if (!open) return null;
  const submit = () => {
    const reading = value.trim();
    if (reading) onConfirm(reading);
  };
  return createPortal(
    <div
      className="modal-backdrop text-input-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="modal-card text-input-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <button
          type="button"
          className="icon-btn text-input-dialog-close"
          aria-label="关闭输入弹窗"
          onClick={onCancel}
        >
          <X aria-hidden />
        </button>
        <h2 id={titleId}>{title}</h2>
        <label htmlFor={inputId}>{label}</label>
        <input
          ref={inputRef}
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={!value.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
