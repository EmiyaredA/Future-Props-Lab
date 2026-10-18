import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import type { usePresentationDraft } from "./usePresentationDraft";
import type { HistoryLocation } from "./presentationHistory";

type DraftController = ReturnType<typeof usePresentationDraft>;

/** Only committed document controls opt into document history inside dialogs. */
function documentTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target.closest(
      '[data-presentation-history="local"], [role="menu"], [role="alertdialog"]',
    )
  )
    return false;
  let dialog = target.closest('[role="dialog"]');
  while (dialog) {
    if (
      !dialog.matches(
        '[data-presentation-history="document"], .custom-color-picker-popover',
      )
    )
      return false;
    dialog = dialog.parentElement?.closest('[role="dialog"]') ?? null;
  }
  return true;
}

export function usePresentationHistory({
  draft,
  blocked,
  onRestore,
}: {
  draft: DraftController;
  blocked: boolean;
  onRestore: (location: HistoryLocation) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const cancelGesture = useRef<(() => boolean) | null>(null);
  const field = useRef("");
  const sequence = useRef(0);
  const fields = useRef(new WeakMap<HTMLElement, string>());
  const range = useRef<HTMLElement | null>(null);
  const composingTarget = useRef<HTMLElement | null>(null);
  const fieldKey = (target: HTMLElement) => {
    let key = fields.current.get(target);
    if (!key) {
      key = `field:${++sequence.current}`;
      fields.current.set(target, key);
    }
    return key;
  };
  const input = (event: SyntheticEvent) => {
    if (!documentTarget(event.target) || !(event.target instanceof HTMLElement))
      return;
    const key = fieldKey(event.target);
    field.current = key;
    // A field's grouping hint belongs only to this synchronous input dispatch.
    // Async media completions must never inherit the focused field's group.
    queueMicrotask(() => {
      if (field.current === key) field.current = "";
    });
  };
  const endRange = () => {
    if (!range.current) return;
    range.current = null;
    draft.setContinuous(false);
    draft.endGroup();
  };
  useEffect(() => {
    window.addEventListener("pointerup", endRange);
    window.addEventListener("pointercancel", endRange);
    window.addEventListener("blur", endRange);
    return () => {
      window.removeEventListener("pointerup", endRange);
      window.removeEventListener("pointercancel", endRange);
      window.removeEventListener("blur", endRange);
    };
  });
  const move = (redo: boolean) => {
    if (blocked || draft.isComposing()) return;
    if (
      root.current?.querySelector(
        '[aria-modal="true"]:not([data-presentation-history="document"])',
      )
    )
      return;
    if (cancelGesture.current?.()) return;
    const location = redo ? draft.redo() : draft.undo();
    if (location) onRestore(location);
  };
  return {
    root,
    cancelGesture,
    group: () => field.current,
    undo: () => move(false),
    redo: () => move(true),
    keyDown: (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        !["z", "y"].includes(key)
      )
        return;
      if (
        blocked ||
        event.nativeEvent.isComposing ||
        draft.isComposing() ||
        !documentTarget(event.target)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      move(key === "y" || event.shiftKey);
    },
    bindings: {
      onInputCapture: input,
      onChangeCapture: input,
      onFocusCapture: () => draft.endGroup(),
      onBlurCapture: (event: SyntheticEvent) => {
        draft.endGroup();
        if (event.target === composingTarget.current) {
          composingTarget.current = null;
          draft.setComposition(false);
        }
      },
      onCompositionStartCapture: (event: SyntheticEvent) => {
        if (
          documentTarget(event.target) &&
          event.target instanceof HTMLElement
        ) {
          composingTarget.current = event.target;
          draft.setComposition(true);
        }
      },
      onCompositionEndCapture: (event: SyntheticEvent) => {
        if (event.target === composingTarget.current) {
          composingTarget.current = null;
          draft.setComposition(false);
        }
      },
      onPointerDownCapture: (event: SyntheticEvent) => {
        const target = event.target;
        if (
          documentTarget(target) &&
          target instanceof HTMLInputElement &&
          target.type === "range"
        ) {
          draft.endGroup();
          range.current = target;
          draft.setContinuous(true);
        }
      },
    },
  };
}
