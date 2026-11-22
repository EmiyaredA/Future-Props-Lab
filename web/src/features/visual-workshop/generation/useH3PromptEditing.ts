import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  expandH3Atoms,
  h3Selection,
  h3SelectionRange,
  restoreH3Caret,
  type H3Selection,
} from "./h3PromptSelection";
import { editH3Source, h3ProtectedSource } from "./h3SourceEdits";
import type { PromptRenderDocument } from "./promptRendering";

type Snapshot = { value: string; selection: H3Selection };

/** Source transactions keep the editable rendering independent of display labels. */
export function useH3PromptEditing({
  root,
  value,
  document,
  maxLength,
  onChange,
  onInsert,
  onMention,
}: {
  root: RefObject<HTMLDivElement | null>;
  value: string;
  document: PromptRenderDocument;
  maxLength: number;
  onChange: (next: string) => void;
  onInsert: (next: string) => void;
  onMention: () => void;
}) {
  const pending = useRef<number | undefined>(undefined);
  const expected = useRef(value);
  const selection = useRef<H3Selection>({
    start: value.length,
    end: value.length,
  });
  const composition = useRef<Snapshot | undefined>(undefined);
  const logical = useRef(false);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const all = useRef(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const read = () => {
    const current = root.current;
    if (all.current) return { start: 0, end: value.length };
    if (logical.current) return { ...selection.current };
    const found = current ? h3Selection(current) : undefined;
    if (found) selection.current = found;
    return selection.current;
  };
  const replace = (
    text: string,
    range = read(),
    persist = false,
    base = value,
  ) => {
    const bounds =
      root.current && range.start !== range.end
        ? expandH3Atoms(root.current, range)
        : range;
    const transaction = editH3Source(
      base,
      bounds,
      text,
      h3ProtectedSource(document, base),
      all.current,
    );
    const next = transaction.value;
    if (next.length > maxLength) {
      setError("提示词已达到长度上限，请精简后再插入。");
      setRevision((current) => current + 1);
      return;
    }
    if (next !== base) {
      undo.current.push({ value: base, selection: range });
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
    } else {
      pending.current = transaction.caret;
      selection.current = { start: transaction.caret, end: transaction.caret };
      logical.current = true;
      setRevision((current) => current + 1);
      return;
    }
    all.current = false;
    logical.current = true;
    expected.current = next;
    pending.current = transaction.caret;
    selection.current = { start: pending.current, end: pending.current };
    setError("");
    setRevision((current) => current + 1);
    (persist ? onInsert : onChange)(next);
  };
  const history = (backwards: boolean) => {
    const from = backwards ? undo : redo;
    const to = backwards ? redo : undo;
    const previous = from.current.pop();
    if (!previous) return;
    to.current.push({ value, selection: read() });
    expected.current = previous.value;
    pending.current = previous.selection.end;
    all.current = false;
    onChange(previous.value);
  };
  const remove = (backwards: boolean, word = false) => {
    const range = { ...read() };
    if (range.start === range.end) {
      const markers = h3ProtectedSource(document, value).filter(
        (item) => item.kind === "marker",
      );
      for (let attempt = 0; attempt < markers.length; attempt += 1) {
        const marker = markers.find((item) =>
          backwards
            ? range.start > item.start && range.start <= item.end
            : range.start >= item.start && range.start < item.end,
        );
        if (!marker) break;
        range.start = range.end = backwards ? marker.start : marker.end;
      }
      const text = backwards
        ? value.slice(0, range.start)
        : value.slice(range.end);
      const segments = [
        ...new Intl.Segmenter(undefined, {
          granularity: word ? "word" : "grapheme",
        }).segment(text),
      ];
      if (backwards)
        range.start = word
          ? (segments.filter((part) => part.isWordLike).at(-1)?.index ?? 0)
          : (segments.at(-1)?.index ?? 0);
      else
        range.end += word
          ? (segments.find((part) => part.isWordLike)?.index ?? 0) +
            (segments.find((part) => part.isWordLike)?.segment.length ??
              text.length)
          : (segments[0]?.segment.length ?? 0);
    }
    replace("", range);
  };
  useLayoutEffect(() => {
    if (value !== expected.current) {
      undo.current = [];
      redo.current = [];
      expected.current = value;
      pending.current = undefined;
      selection.current = { start: value.length, end: value.length };
      all.current = false;
      logical.current = false;
    }
    if (pending.current !== undefined && root.current) {
      root.current.focus({ preventScroll: true });
      restoreH3Caret(root.current, pending.current);
      pending.current = undefined;
    }
  }, [value, revision, root]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const beforeInput = (event: InputEvent) => {
      if (
        event.isComposing ||
        composition.current ||
        /Composition/.test(event.inputType)
      )
        return;
      if (
        event.inputType === "historyUndo" ||
        event.inputType === "historyRedo"
      ) {
        event.preventDefault();
        history(event.inputType === "historyUndo");
      } else if (event.inputType.startsWith("delete")) {
        event.preventDefault();
        remove(
          event.inputType.endsWith("Backward"),
          event.inputType.includes("Word"),
        );
      } else if (event.inputType.startsWith("insert")) {
        event.preventDefault();
        if (event.data === "@") {
          read();
          onMention();
        } else {
          const target =
            event.inputType === "insertReplacementText"
              ? event.getTargetRanges?.()[0]
              : undefined;
          const range = target ? h3SelectionRange(element, target) : undefined;
          replace(
            event.inputType === "insertParagraph" ||
              event.inputType === "insertLineBreak"
              ? "\n"
              : (event.data ?? event.dataTransfer?.getData("text/plain") ?? ""),
            range ?? read(),
          );
        }
      } else event.preventDefault();
    };
    element.addEventListener("beforeinput", beforeInput);
    return () => element.removeEventListener("beforeinput", beforeInput);
  });
  return {
    revision,
    error,
    read,
    replace,
    caret: logical.current ? selection.current.end : undefined,
    handlers: {
      onMouseUp: () => {
        all.current = false;
        logical.current = false;
        read();
      },
      onKeyUp: () => {
        if (!all.current && !logical.current) read();
      },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (
          event.nativeEvent.isComposing ||
          composition.current ||
          event.target !== root.current
        )
          return;
        const modifier = event.metaKey || event.ctrlKey;
        if (/^(Arrow|Home|End|Page)/.test(event.key)) {
          logical.current = false;
          all.current = false;
        }
        if (modifier && event.key.toLowerCase() === "a") {
          all.current = true;
          return;
        }
        if (modifier && (event.key === "End" || event.key === "Home")) {
          event.preventDefault();
          const offset =
            event.key === "End"
              ? value.length
              : Number(
                  root.current?.querySelector<HTMLElement>(
                    "[data-prompt-source-start]",
                  )?.dataset.promptSourceStart ?? 0,
                );
          selection.current = { start: offset, end: offset };
          logical.current = true;
          pending.current = offset;
          setRevision((current) => current + 1);
          return;
        }
        if (
          modifier &&
          (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
        ) {
          event.preventDefault();
          event.stopPropagation();
          history(event.key.toLowerCase() === "z" && !event.shiftKey);
          return;
        }
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          remove(event.key === "Backspace", event.altKey || event.ctrlKey);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          replace("\n");
        }
      },
      onCopy: (event: ClipboardEvent<HTMLDivElement>) => {
        const range = read();
        event.preventDefault();
        event.clipboardData.setData(
          "text/plain",
          value.slice(range.start, range.end),
        );
      },
      onCut: (event: ClipboardEvent<HTMLDivElement>) => {
        const range = read();
        event.preventDefault();
        event.clipboardData.setData(
          "text/plain",
          value.slice(range.start, range.end),
        );
        replace("", range);
      },
      onPaste: (event: ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        replace(event.clipboardData.getData("text/plain"));
      },
      onCompositionStart: () => {
        composition.current = { value, selection: { ...read() } };
      },
      onCompositionEnd: (event: CompositionEvent<HTMLDivElement>) => {
        const initial = composition.current;
        composition.current = undefined;
        if (initial && event.data)
          replace(event.data, initial.selection, false, initial.value);
        else if (initial) {
          pending.current = initial.selection.end;
          setRevision((current) => current + 1);
        }
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
      },
    },
  };
}
