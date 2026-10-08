import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

export function SyncConfirmation({
  open,
  title,
  description,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="article-sync-confirm-overlay" />
        <Dialog.Content
          className="article-sync-confirm"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!pending) onCancel();
          }}
        >
          <span className="article-sync-confirm-icon">
            <AlertCircle size={24} aria-hidden />
          </span>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div>{description}</div>
          </Dialog.Description>
          <div className="article-sync-actions">
            <button className="btn" disabled={pending} onClick={onCancel}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={pending}
              onClick={() => void onConfirm()}
            >
              {pending ? "正在处理…" : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
