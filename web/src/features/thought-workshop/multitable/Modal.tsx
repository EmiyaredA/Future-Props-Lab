import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="multitable-overlay" />
        <Dialog.Content
          className="multitable-dialog"
          aria-describedby={undefined}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close className="btn multitable-close" aria-label="关闭">
            ×
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
