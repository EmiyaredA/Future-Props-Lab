import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function IntegrationModal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const focusFrame = requestAnimationFrame(() => {
      if (!dialog.current?.contains(document.activeElement)) {
        closeButton.current?.focus();
      }
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="integration-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className={`integration-modal${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button
            ref={closeButton}
            type="button"
            className="icon-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

export function StatusBadge({
  enabled,
  status,
}: {
  enabled: boolean;
  status: string;
}) {
  const label = !enabled
    ? "草稿"
    : status === "healthy"
      ? "正常"
      : status === "failed"
        ? "异常"
        : "未验证";
  return (
    <span className={`integration-status ${!enabled ? "draft" : status}`}>
      {label}
    </span>
  );
}

export function ToggleButton({
  value,
  onChange,
  label = "启用",
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <button
      className={`integration-switch${value ? " on" : ""}`}
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span aria-hidden /> {label}
    </button>
  );
}

export function PanelMessage({ children }: { children: ReactNode }) {
  return <div className="integration-message">{children}</div>;
}
