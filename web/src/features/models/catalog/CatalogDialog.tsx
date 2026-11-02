import { LoadingState } from "@shared/ui/LoadingState";
import { useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { apiErrorMessage } from "@platform/api/errors";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";

export function CatalogDialog({
  title,
  children,
  onClose,
  onSave,
  onRefresh,
  disabled = false,
  label = "保存",
  hideSave = false,
  className = "",
  subtitle,
  icon,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  hideSave?: boolean;
  className?: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!busy) onClose();
  };
  const focus = useDrawerFocus<HTMLFormElement>(close, true, false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || disabled) return;
    setError("");
    setBusy(true);
    try {
      await onSave();
      onClose();
    } catch (cause) {
      setError(apiErrorMessage(cause, "保存失败，请稍后重试"));
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div
      className="mc-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form
        className={`mc-dialog ${className}`}
        ref={focus}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(event) => void submit(event)}
      >
        <header>
          <div className="mc-dialog-heading">
            {icon ? (
              <span className="mc-dialog-heading-icon" aria-hidden>
                {icon}
              </span>
            ) : null}
            <div>
              <h2>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
          <button
            type="button"
            className="mc-icon"
            aria-label="关闭"
            disabled={busy}
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <div className="mc-dialog-scroll">
          <fieldset className="mc-dialog-body" disabled={busy}>
            {children}
          </fieldset>
        </div>
        {error && (
          <p className="mc-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="btn" disabled={busy} onClick={close}>
            取消
          </button>
          {error && onRefresh && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onRefresh();
                  setError(
                    "已刷新目录，草稿已保留。请核对后保存，或取消并重新打开查看最新配置。",
                  );
                } catch (cause) {
                  setError(
                    cause instanceof Error ? cause.message : String(cause),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              刷新核对
            </button>
          )}
          {!hideSave && (
            <button className="btn primary" disabled={busy || disabled}>
              {busy ? <LoadingState variant="inline" label="保存中…" /> : label}
            </button>
          )}
        </footer>
      </form>
    </div>,
    document.body,
  );
}
