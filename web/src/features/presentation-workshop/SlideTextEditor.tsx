import { useEffect, useLayoutEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { ParagraphStyle, ScriptMark } from "./editor/textExtensions";
import Highlight from "@tiptap/extension-highlight";
import StarterKit from "@tiptap/starter-kit";
import {
  TextStyle,
  Color,
  FontSize,
  FontFamily,
} from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { defaultRun } from "./templates";
import { fontFamily, fromEditor, toEditor } from "./textAdapter";
import type { SlideElement, Paragraph } from "./types";
import { elementStyle } from "./geometry";

export function SlideTextEditor({
  element,
  onChange,
  onComposition,
  onReady,
  onExit,
  localHistory = false,
}: {
  localHistory?: boolean;
  element: SlideElement;
  onChange: (
    paragraphs: Paragraph[],
    format?: boolean,
    height?: number,
  ) => void;
  onComposition: (active: boolean) => void;
  onReady: (editor: Editor | null) => void;
  onExit: () => void;
}) {
  const callbacks = useRef({
    onChange,
    onComposition,
    onReady,
    onExit,
    element,
  });
  callbacks.current = { onChange, onComposition, onReady, onExit, element };
  const fallback = element.paragraphs[0]?.runs[0] ?? defaultRun();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: localHistory ? {} : false,
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: {},
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        link: false,
      }),
      Highlight.configure({ multicolor: true }),
      ScriptMark,
      TextStyle,
      Color,
      FontSize,
      FontFamily,
      TextAlign.configure({ types: ["paragraph"] }),
      ParagraphStyle,
    ],
    content: toEditor(element.paragraphs),
    editorProps: {
      attributes: {
        "aria-label": "编辑幻灯片文字",
        role: "textbox",
        "aria-multiline": "true",
      },
      handleDOMEvents: {
        paste: (view, event) => {
          if (!event.clipboardData) return false;
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          // Choose the plain-text parser before ProseMirror prefers HTML.
          // Clearing HTML later would paste an empty slice over the selection.
          if (text) view.pasteText(text, event);
          return true;
        },
        compositionstart: () => {
          callbacks.current.onComposition(true);
          return false;
        },
        compositionend: () => {
          callbacks.current.onComposition(false);
          return false;
        },
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing || view.composing) return false;
        const { $from, empty } = view.state.selection;
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          empty &&
          $from.parent.type.name === "paragraph" &&
          $from.parent.content.size === 0 &&
          ($from.parent.attrs.bullet || $from.parent.attrs.numbered)
        ) {
          view.dispatch(
            view.state.tr.setNodeMarkup($from.before(), undefined, {
              ...$from.parent.attrs,
              bullet: false,
              numbered: false,
            }),
          );
          return true;
        }
        if (event.key === "Escape") {
          callbacks.current.onExit();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor, transaction }) =>
      callbacks.current.onChange(
        fromEditor(editor.getJSON(), fallback),
        !!transaction.getMeta("presentationFormat"),
        callbacks.current.element.text_layout?.auto_fit &&
          !callbacks.current.element.text_layout.vertical
          ? Math.max(
              1,
              Math.min(
                10000,
                editor.view.dom.scrollHeight +
                  2 * (callbacks.current.element.text_layout.padding ?? 8),
              ),
            )
          : undefined,
      ),
  });
  useEffect(() => {
    if (!editor) return;
    callbacks.current.onReady(editor);
    editor.commands.setTextSelection(editor.state.doc.content.size);
    editor.view.focus();
    return () => {
      callbacks.current.onReady(null);
      callbacks.current.onComposition(false);
    };
  }, [editor]);
  useEffect(() => {
    if (!editor || editor.view.composing) return;
    const json = toEditor(element.paragraphs);
    if (
      JSON.stringify(toEditor(fromEditor(editor.getJSON(), fallback))) !==
      JSON.stringify(json)
    )
      editor.commands.setContent(json, { emitUpdate: false });
  }, [editor, element.paragraphs, fallback]);
  useLayoutEffect(() => {
    if (
      !editor ||
      !element.text_layout?.auto_fit ||
      element.text_layout.vertical ||
      editor.view.composing
    )
      return;
    const height = Math.max(
      1,
      Math.min(
        10000,
        editor.view.dom.scrollHeight + 2 * element.text_layout.padding,
      ),
    );
    if (Math.abs(height - element.height) > 1)
      callbacks.current.onChange(element.paragraphs, false, height);
  }, [editor, element.text_layout, element.height, element.paragraphs]);
  return (
    <div
      className="presentation-text-editor"
      data-auto-fit={!!element.text_layout?.auto_fit}
      style={{
        ...elementStyle(element),
        padding: element.text_layout?.padding ?? 8,
        letterSpacing: element.text_layout?.letter_spacing ?? 0,
        writingMode: element.text_layout?.vertical ? "vertical-rl" : undefined,
        fontSize: fallback.size,
        color: fallback.color,
        fontFamily: fontFamily(fallback.font),
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
