import { useCallback, useRef, useState } from "react";
import type { Definition } from "../model";
/** Gesture previews stay in SlideCanvas; only completed edits enter this history. */
export function useTemplateHistory(initial: Definition) {
  const [value, setValue] = useState(initial),
    stack = useRef({ past: [] as Definition[], future: [] as Definition[] });
  const current = useRef(value);
  current.current = value;
  const commit = useCallback((next: Definition) => {
    if (JSON.stringify(current.current) === JSON.stringify(next)) return;
    stack.current.past.push(current.current);
    stack.current.past = stack.current.past.slice(-80);
    stack.current.future = [];
    current.current = next;
    setValue(next);
  }, []);
  const undo = () => {
    const next = stack.current.past.pop();
    if (!next) return;
    stack.current.future.push(current.current);
    current.current = next;
    setValue(next);
  };
  const redo = () => {
    const next = stack.current.future.pop();
    if (!next) return;
    stack.current.past.push(current.current);
    current.current = next;
    setValue(next);
  };
  const reset = (next: Definition) => {
    stack.current = { past: [], future: [] };
    current.current = next;
    setValue(next);
  };
  return {
    value,
    commit,
    undo,
    redo,
    reset,
    canUndo: stack.current.past.length > 0,
    canRedo: stack.current.future.length > 0,
  };
}
