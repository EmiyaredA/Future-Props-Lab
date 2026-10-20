import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

/** Radix handles Escape at document capture, before the nested control can close. */
export function keepDialogEscapeLocal(event: KeyboardEvent) {
  if (
    event.isComposing ||
    (event.target instanceof Element &&
      event.target.closest('[popover], [role="listbox"]'))
  )
    event.preventDefault();
}

export function containDialogComposition(event: ReactKeyboardEvent) {
  if (event.nativeEvent.isComposing) event.stopPropagation();
}

/** These dialogs are opened by commands rather than a Radix Dialog.Trigger. */
export function useDialogReturnFocus() {
  const opener = useRef(document.activeElement);
  return (event: Event) => {
    event.preventDefault();
    if (opener.current instanceof HTMLElement && opener.current.isConnected)
      opener.current.focus({ preventScroll: true });
  };
}
