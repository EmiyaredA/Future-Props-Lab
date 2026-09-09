import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
export function ManagementDialog({
  title,
  close,
  children,
  pending = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  pending?: boolean;
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  const ref = useDrawerFocus(
    () => {
      if (!pending) close();
    },
    true,
    false,
  );
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) close();
      }}
    >
      <section
        className="modal-card management-dialog"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭"
            disabled={pending}
            onClick={close}
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
export function ManagementPagination({
  total,
  page,
  pageSize = 25,
  setPage,
}: {
  total: number;
  page: number;
  pageSize?: number;
  setPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="management-pagination" aria-label="分页">
      <span>
        共 {total} 条 · 第 {page} / {pages} 页
      </span>
      <div className="button-row">
        <button
          className="btn small"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </button>
        <button
          className="btn small"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </div>
    </nav>
  );
}
export function ManagementError({ error }: { error: unknown }) {
  return error ? (
    <p className="inline-alert danger" role="alert">
      {error instanceof Error ? error.message : "操作失败，请重试"}
    </p>
  ) : null;
}
