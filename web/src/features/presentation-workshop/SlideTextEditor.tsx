import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
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

const ParagraphStyle = Extension.create({
  name: "presentationParagraphStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          lineHeight: {
            default: 1.3,
            parseHTML: (el) => Number(el.dataset.lineHeight) || 1.3,
            renderHTML: (attrs) => ({
              "data-line-height": attrs.lineHeight,
              style: `line-height: ${attrs.lineHeight}`,
            }),
          },
          bullet: {
            default: false,
            parseHTML: (el) => el.dataset.bullet === "true",
            renderHTML: (attrs) => ({ "data-bullet": String(attrs.bullet) }),
          },
          numbered: {
            default: false,
            parseHTML: (el) => el.dataset.numbered === "true",
            renderHTML: (attrs) => ({
              "data-numbered": String(attrs.numbered),
            }),
          },
        },
      },
    ];
  },
});
export function SlideTextEditor({
  element,
  onChange,
  onComposition,
  onReady,
  onExit,
}: {
  element: SlideElement;
  onChange: (paragraphs: Paragraph[], format?: boolean) => void;
  onComposition: (active: boolean) => void;
  onReady: (editor: Editor | null) => void;
  onExit: () => void;
}) {
  const callbacks = useRef({
    onChange,
    onComposition,
    onReady,
    onExit,
  });
  callbacks.current = { onChange, onComposition, onReady, onExit };
  const fallback = element.paragraphs[0]?.runs[0] ?? defaultRun();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        link: false,
      }),
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
  return (
    <div
      className="presentation-text-editor"
      style={{
        ...elementStyle(element),
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
