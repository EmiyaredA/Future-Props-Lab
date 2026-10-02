import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";

type GuardRegistration = (
  guard: ((proceed: () => void) => boolean) | null,
) => void;
export function VideoEditorSaveGuard({
  unsaved,
  busy,
  failedCount,
  operations = [],
  discard,
  register,
}: {
  unsaved: boolean;
  busy?: boolean;
  failedCount?: number;
  operations?: string[];
  discard: () => boolean;
  register?: GuardRegistration;
}) {
  const [open, setOpen] = useState(false);
  const continuation = useRef<(() => void) | null>(null);
  const current = useRef(unsaved);
  current.current = unsaved;
  useEffect(() => {
    register?.((proceed) => {
      if (!current.current) return false;
      continuation.current = proceed;
      setOpen(true);
      return true;
    });
    return () => register?.(null);
  }, [register]);
  useEffect(() => {
    if (!unsaved && continuation.current) {
      const proceed = continuation.current;
      continuation.current = null;
      setOpen(false);
      proceed();
    }
  }, [unsaved]);
  useEffect(() => {
    if (!unsaved) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [unsaved]);
  return (
    <>
      {failedCount ? (
        <button type="button" onClick={() => setOpen(true)}>
          查看未保存操作（{failedCount}）
        </button>
      ) : null}
      <ConfirmDialog
        open={open}
        title={busy ? "正在保存" : "处理未保存操作"}
        description={
          busy
            ? "请等待当前保存完成。"
            : `有 ${failedCount ?? 0} 项操作未确认保存（${operations.map((kind) => (kind === "undo" ? "撤销" : kind === "redo" ? "重做" : kind)).join("、")}）。请核对服务器快照后重新编辑；这些操作不会自动重放。`
        }
        pending={Boolean(busy)}
        confirmLabel="放弃未保存操作"
        cancelLabel="留在编辑器"
        onCancel={() => {
          continuation.current = null;
          setOpen(false);
        }}
        onConfirm={() => {
          if (!discard()) return;
          const proceed = continuation.current;
          continuation.current = null;
          setOpen(false);
          proceed?.();
        }}
      />
    </>
  );
}
