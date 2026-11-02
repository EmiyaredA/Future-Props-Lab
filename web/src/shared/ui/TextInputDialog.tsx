import { LoadingState } from "@shared/ui/LoadingState";
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import "@shared/ui/text-input-dialog.css";

export function TextInputDialog({
  open,
  className = "",
  title,
  label,
  initialValue = "",
  confirmLabel = "确认",
  cancelLabel = "取消",
  pending = false,
  confirmDisabled = false,
  error,
  maxLength,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  className?: string;
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  confirmDisabled?: boolean;
  error?: string;
  maxLength?: number;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef(onCancel);
  const pendingRef = useRef(pending);
  const [value, setValue] = useState(initialValue);
  cancelRef.current = onCancel;
  pendingRef.current = pending;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const ownsScrollLock = previousOverflow !== "hidden";
    if (ownsScrollLock) document.body.style.overflow = "hidden";
    setValue(initialValue);
    const close = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!pendingRef.current) cancelRef.current();
      }
      if (event.key === "Tab") {
        const controls = formRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        );
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (!first || !formRef.current?.contains(document.activeElement)) {
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
    window.addEventListener("keydown", close);
    const frame = requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true }),
    );
    return () => {
      window.removeEventListener("keydown", close);
      cancelAnimationFrame(frame);
      if (ownsScrollLock) document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [initialValue, open]);

  if (!open) return null;
  const submit = () => {
    const reading = value.trim();
    if (reading && !pending && !confirmDisabled) onConfirm(reading);
  };
  return createPortal(
    <div
      className="modal-backdrop text-input-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <form
        ref={formRef}
        className={`modal-card text-input-dialog ${className}`}
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
          disabled={pending}
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
          disabled={pending}
          maxLength={maxLength}
          aria-describedby={error ? `${inputId}-error` : undefined}
          aria-invalid={Boolean(error)}
          onChange={(event) => setValue(event.target.value)}
        />
        {error ? (
          <p id={`${inputId}-error`} role="alert">
            {error}
          </p>
        ) : null}
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
            type="submit"
            className="btn primary"
            disabled={pending || confirmDisabled || !value.trim()}
          >
            {pending ? (
              <LoadingState variant="inline" label="保存中…" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
