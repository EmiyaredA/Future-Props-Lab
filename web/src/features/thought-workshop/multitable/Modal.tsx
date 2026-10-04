import * as Dialog from "@radix-ui/react-dialog";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
export function Modal({
  title,
  close,
  children,
  variant = "modal",
  anchor,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  variant?: "modal" | "drawer" | "field";
  anchor?: HTMLElement;
}) {
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const [placement, setPlacement] = useState<CSSProperties>();
  useEffect(() => {
    if (variant !== "field") return;
    const place = () => {
      const rect = anchor?.getBoundingClientRect();
      const width = Math.min(420, window.innerWidth - 32);
      const top =
        window.innerWidth < 600 ||
        !rect ||
        window.innerHeight - rect.bottom < 360
          ? 16
          : rect.bottom + 6;
      setPlacement({
        width,
        left: Math.max(
          16,
          Math.min(rect?.left ?? 16, window.innerWidth - width - 16),
        ),
        top,
        maxHeight: window.innerHeight - top - 16,
        transform: "none",
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, variant]);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={`multitable-overlay${variant === "field" ? " is-field-overlay" : ""}`}
        />
        <Dialog.Content
          className={`multitable-dialog${variant === "drawer" ? " is-drawer" : variant === "field" ? " is-field-editor" : ""}`}
          style={placement}
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
