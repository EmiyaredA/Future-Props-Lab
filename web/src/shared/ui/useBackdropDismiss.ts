import { useRef, type MouseEvent, type PointerEvent } from "react";

/** Dismiss only a click that both starts and ends on the backdrop. */
export function useBackdropDismiss(onDismiss: () => void) {
  const startedOutside = useRef(false);

  function isBackdrop(
    event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>,
  ) {
    const element = event.currentTarget;
    if (event.target !== element) return false;
    // Native dialog backdrops retarget events to the dialog itself. Padding
    // also targets the dialog, so check bounds rather than target alone.
    if (!(element instanceof HTMLDialogElement)) return true;
    const rect = element.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      startedOutside.current = event.button === 0 && isBackdrop(event);
    },
    onPointerCancel() {
      startedOutside.current = false;
    },
    onClick(event: MouseEvent<HTMLElement>) {
      const dismiss = startedOutside.current && isBackdrop(event);
      startedOutside.current = false;
      if (!dismiss) return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    },
  };
}
