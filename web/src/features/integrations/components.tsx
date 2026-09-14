import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { useIntegrationInteraction } from "./interaction";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function IntegrationModal({
  title,
  onClose,
  children,
  wide = false,
  protect = false,
  pending = false,
  resetKey,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  protect?: boolean;
  pending?: boolean;
  resetKey?: number;
}) {
  const { register } = useIntegrationInteraction();
  const [dirty, setDirty] = useState(false);
  useEffect(() => setDirty(false), [resetKey]);
  const [continuation, setContinuation] = useState<(() => void) | null>(null);
  const deferredNavigation = useRef<(() => void) | null>(null);
  const state = useRef({ dirty, pending, onClose });
  state.current = { dirty, pending, onClose };
  const requestClose = () => {
    if (state.current.pending) return;
    if (protect && state.current.dirty)
      setContinuation(() => state.current.onClose);
    else state.current.onClose();
  };
  useEffect(() => {
    if (!protect || (!dirty && !pending)) return;
    return register((proceed) => {
      if (state.current.pending) deferredNavigation.current = proceed;
      else
        setContinuation(() => () => {
          state.current.onClose();
          proceed();
        });
      return true;
    });
  }, [register, protect, dirty, pending]);
  useEffect(() => {
    if (pending || !deferredNavigation.current) return;
    const frame = requestAnimationFrame(() => {
      const proceed = deferredNavigation.current;
      deferredNavigation.current = null;
      if (!proceed) return;
      const next = () => {
        state.current.onClose();
        proceed();
      };
      if (state.current.dirty) setContinuation(() => next);
      else next();
    });
    return () => cancelAnimationFrame(frame);
  }, [pending]);
  useEffect(
    () => () => {
      // A successful submit can close the form before pending becomes false.
      const proceed = deferredNavigation.current;
      if (proceed) queueMicrotask(proceed);
    },
    [],
  );
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = requestClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
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
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialog}
        aria-busy={pending}
        onChangeCapture={() => {
          if (protect) setDirty(true);
        }}
        onKeyDownCapture={(event) => {
          if (
            protect &&
            ["Enter", " "].includes(event.key) &&
            (event.target as HTMLElement).closest('[role="listbox"]')
          )
            setDirty(true);
        }}
        onClickCapture={(event) => {
          const button = (event.target as HTMLElement).closest(
            'button, [role="option"]',
          );
          if (
            button &&
            (button.textContent?.trim() === "取消" ||
              button.textContent?.trim() === "关闭")
          ) {
            event.preventDefault();
            event.stopPropagation();
            requestClose();
          } else if (
            button &&
            protect &&
            (["switch", "option"].includes(button.getAttribute("role") ?? "") ||
              button.textContent?.includes("明确清除"))
          )
            setDirty(true);
        }}
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
            disabled={pending}
            onClick={requestClose}
          >
            ×
          </button>
        </header>
        <fieldset disabled={pending} style={{ display: "contents" }}>
          {children}
        </fieldset>
      </section>
      <ConfirmDialog
        open={Boolean(continuation)}
        title="放弃未保存的修改？"
        description="当前输入或已选择的文件尚未提交。"
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        onCancel={() => setContinuation(null)}
        onConfirm={() => {
          const next = continuation;
          setContinuation(null);
          setDirty(false);
          next?.();
        }}
      />
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
