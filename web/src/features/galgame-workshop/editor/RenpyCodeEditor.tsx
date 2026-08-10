import { useEffect, useRef } from "react";
import {
  autocompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { python } from "@codemirror/lang-python";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";

export function RenpyCodeEditor({
  value,
  completions,
  onChange,
}: {
  value: string;
  completions: Completion[];
  onChange: (value: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const completionsRef = useRef(completions);
  onChangeRef.current = onChange;
  completionsRef.current = completions;

  useEffect(() => {
    if (!hostRef.current) return;
    const complete = (context: CompletionContext) => {
      const word = context.matchBefore(/[\w-]*/);
      if (!word || (!context.explicit && word.from === word.to)) return null;
      return { from: word.from, options: completionsRef.current };
    };
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          drawSelection(),
          highlightActiveLine(),
          python(),
          autocompletion({ override: [complete] }),
          keymap.of([]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Ren’Py 剧本",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return <div className="galgame-renpy-code" ref={hostRef} />;
}
