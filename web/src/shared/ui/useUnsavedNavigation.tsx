import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useNavigationProtection } from "./navigationGuards";

export function useUnsavedNavigation({
  dirty,
  busy,
  title,
  description,
}: {
  dirty: boolean;
  busy: boolean;
  title: string;
  description: string;
}) {
  const protection = useNavigationProtection();
  const current = useRef({ dirty, busy });
  current.current = { dirty, busy };
  const pending = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!protection) return;
    return protection.register((resume) => {
      if (!current.current.dirty && !current.current.busy) return false;
      pending.current = resume;
      setOpen(true);
      return true;
    });
  }, [protection]);
  useEffect(() => {
    if (!protection || (!dirty && !busy)) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (protection.allowsUnload()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [protection, dirty, busy]);
  const confirm = () => {
    const resume = pending.current;
    pending.current = null;
    setOpen(false);
    resume?.();
  };
  return {
    action: (proceed: () => void) => {
      if (!protection || !protection.protect(proceed)) proceed();
    },
    dialog: (
      <ConfirmDialog
        open={open}
        title={title}
        description={
          busy ? "操作仍在进行，请等待结果确认后再离开。" : description
        }
        pending={busy}
        confirmLabel="放弃填写并继续"
        cancelLabel="留在此页"
        onCancel={() => {
          pending.current = null;
          setOpen(false);
        }}
        onConfirm={confirm}
      />
    ),
  };
}
