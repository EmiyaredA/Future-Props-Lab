import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useNavigationProtection, type Guard } from "./navigationGuards";

export function useUnsavedNavigation({
  dirty,
  busy,
  title,
  description,
  registerNavigationGuard,
}: {
  dirty: boolean;
  busy: boolean;
  title: string;
  description: string;
  registerNavigationGuard?: (guard: Guard | null) => void;
}) {
  const protection = useNavigationProtection();
  const current = useRef({ dirty, busy });
  current.current = { dirty, busy };
  const pending = useRef<(() => void) | null>(null);
  const legacyApprovedUnload = useRef(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const guard: Guard = (resume) => {
      if (!current.current.dirty && !current.current.busy) return false;
      pending.current = resume;
      setOpen(true);
      return true;
    };
    if (protection) return protection.register(guard);
    if (!registerNavigationGuard) return;
    registerNavigationGuard(guard);
    return () => registerNavigationGuard(null);
  }, [protection, registerNavigationGuard]);
  useEffect(() => {
    if ((!protection && !registerNavigationGuard) || (!dirty && !busy)) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (protection?.allowsUnload() || legacyApprovedUnload.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [protection, registerNavigationGuard, dirty, busy]);
  const confirm = () => {
    const resume = pending.current;
    pending.current = null;
    setOpen(false);
    if (!protection && registerNavigationGuard) {
      legacyApprovedUnload.current = true;
      setTimeout(() => {
        legacyApprovedUnload.current = false;
      }, 0);
    }
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
