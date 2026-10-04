import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";
export function Modal({
  title,
  close,
  children,
  variant = "modal",
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  variant?: "modal" | "drawer";
}) {
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
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
          className={`multitable-dialog${variant === "drawer" ? " is-drawer" : ""}`}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            const element = returnFocus.current;
            if (element?.isConnected) {
              event.preventDefault();
              element.focus();
            }
          }}
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
