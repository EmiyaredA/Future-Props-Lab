/* eslint-disable react-refresh/only-export-components -- Shared find engine and its editor panel. */
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import { useEffect, useRef, useState } from "react";

export type FindOptions = {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
};
export type Match = { from: number; to: number };
export function findMatches(doc: Node, options: FindOptions): Match[] {
  if (!options.query) return [];
  const regex = new RegExp(
      options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      options.caseSensitive ? "gu" : "giu",
    ),
    matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = "";
    node.forEach((child) => {
      text += child.isText ? child.text : "\ufffc".repeat(child.nodeSize);
    });
    let boundaries: Set<number> | null = null;
    if (options.wholeWord) {
      boundaries = new Set([0, text.length]);
      for (const part of new Intl.Segmenter("zh", {
        granularity: "word",
      }).segment(text)) {
        boundaries.add(part.index);
        boundaries.add(part.index + part.segment.length);
      }
    }
    for (const match of text.matchAll(regex)) {
      const start = match.index!,
        end = start + match[0].length;
      if (!boundaries || (boundaries.has(start) && boundaries.has(end)))
        matches.push({ from: pos + 1 + start, to: pos + 1 + end });
    }
    return false;
  });
  return matches;
}
export const findKey = new PluginKey<{
  options: FindOptions;
  decorations: DecorationSet;
}>("thought-find");
export const FindDecorations = Extension.create({
  name: "thoughtFind",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findKey,
        state: {
          init() {
            return {
              options: { query: "", caseSensitive: false, wholeWord: false },
              decorations: DecorationSet.empty,
            };
          },
          apply(tr, old) {
            const options = tr.getMeta(findKey) ?? old.options;
            if (!tr.docChanged && !tr.getMeta(findKey)) return old;
            return {
              options,
              decorations: DecorationSet.create(
                tr.doc,
                findMatches(tr.doc, options).map((match) =>
                  Decoration.inline(match.from, match.to, {
                    class: "thought-search-match",
                  }),
                ),
              ),
            };
          },
        },
        props: {
          decorations(state) {
            return findKey.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});
export function replaceMatches(
  editor: Editor,
  options: FindOptions,
  replacement: string,
  all: boolean,
  index = 0,
) {
  if (!editor.isEditable || editor.view.composing) return false;
  const matches = findMatches(editor.state.doc, options),
    chosen = all ? matches : matches.slice(index, index + 1);
  if (!chosen.length) return false;
  const tr = closeHistory(editor.state.tr);
  for (const match of [...chosen].reverse())
    tr.insertText(replacement, match.from, match.to);
  editor.view.dispatch(tr);
  return true;
}
export function FindPanel({
  editor,
  replace,
  close,
}: {
  editor: Editor;
  replace: boolean;
  close: () => void;
}) {
  const [options, setOptions] = useState<FindOptions>({
      query: new URLSearchParams(location.search).get("find") || "",
      caseSensitive: false,
      wholeWord: false,
    }),
    [replacement, setReplacement] = useState(""),
    [index, setIndex] = useState(0),
    [, refresh] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const update = () => refresh((value) => value + 1);
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);
  useEffect(() => {
    if (!editor.isDestroyed) {
      const matches = findMatches(editor.state.doc, options);
      const tr = editor.state.tr
        .setMeta(findKey, options)
        .setMeta("addToHistory", false);
      if (matches.length)
        tr.setSelection(
          TextSelection.create(
            editor.state.doc,
            matches[0].from,
            matches[0].to,
          ),
        ).scrollIntoView();
      editor.view.dispatch(tr);
      setIndex(0);
    }
  }, [editor, options]);
  useEffect(
    () => () => {
      if (!editor.isDestroyed)
        editor.view.dispatch(
          editor.state.tr
            .setMeta(findKey, {
              query: "",
              caseSensitive: false,
              wholeWord: false,
            })
            .setMeta("addToHistory", false),
        );
    },
    [editor],
  );
  const matches = findMatches(editor.state.doc, options);
  const next = (direction: number) => {
    if (!matches.length) return;
    const value = (index + direction + matches.length) % matches.length;
    setIndex(value);
    editor.view.dispatch(
      editor.state.tr
        .setSelection(
          TextSelection.create(
            editor.state.doc,
            matches[value].from,
            matches[value].to,
          ),
        )
        .scrollIntoView(),
    );
  };
  return (
    <div
      className="thought-find"
      role="search"
      aria-label="文内查找"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          close();
          editor.commands.focus();
        }
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          next(event.shiftKey ? -1 : 1);
        }
      }}
    >
      <input
        ref={input}
        aria-label="查找文本"
        value={options.query}
        onChange={(event) => {
          setOptions({ ...options, query: event.target.value });
          setIndex(0);
        }}
      />
      <button
        className="btn"
        aria-pressed={options.caseSensitive}
        onClick={() =>
          setOptions({ ...options, caseSensitive: !options.caseSensitive })
        }
      >
        区分大小写
      </button>
      <button
        className="btn"
        aria-pressed={options.wholeWord}
        onClick={() =>
          setOptions({ ...options, wholeWord: !options.wholeWord })
        }
      >
        整词
      </button>
      <span role="status">
        {matches.length ? Math.min(index + 1, matches.length) : 0} /{" "}
        {matches.length}
      </span>
      <button
        className="btn"
        disabled={!matches.length}
        onClick={() => next(-1)}
      >
        上一处
      </button>
      <button
        className="btn"
        disabled={!matches.length}
        onClick={() => next(1)}
      >
        下一处
      </button>
      {replace && editor.isEditable && (
        <>
          <input
            aria-label="替换文本"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button
            className="btn"
            disabled={!matches.length}
            onClick={() =>
              replaceMatches(
                editor,
                options,
                replacement,
                false,
                Math.min(index, matches.length - 1),
              )
            }
          >
            替换
          </button>
          <button
            className="btn"
            disabled={!matches.length}
            onClick={() => replaceMatches(editor, options, replacement, true)}
          >
            全部替换
          </button>
        </>
      )}
      <button className="btn" onClick={close}>
        关闭查找
      </button>
    </div>
  );
}
