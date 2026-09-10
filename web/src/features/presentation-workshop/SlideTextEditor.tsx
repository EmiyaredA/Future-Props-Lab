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
  undo,
  redo,
}: {
  element: SlideElement;
  onChange: (paragraphs: Paragraph[], format?: boolean) => void;
  onComposition: (active: boolean) => void;
  onReady: (editor: Editor | null) => void;
  onExit: () => void;
  undo: () => void;
  redo: () => void;
}) {
  const callbacks = useRef({
    onChange,
    onComposition,
    onReady,
    onExit,
    undo,
    redo,
  });
  callbacks.current = { onChange, onComposition, onReady, onExit, undo, redo };
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
        compositionstart: () => {
          callbacks.current.onComposition(true);
          return false;
        },
        compositionend: () => {
          callbacks.current.onComposition(false);
          return false;
        },
      },
      handleKeyDown: (_, event) => {
        if (event.isComposing) return false;
        if (event.key === "Escape") {
          callbacks.current.onExit();
          return true;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          ["z", "y"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          if (event.shiftKey || event.key.toLowerCase() === "y")
            callbacks.current.redo();
          else callbacks.current.undo();
          return true;
        }
        return false;
      },
      transformPastedHTML: () => "",
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
      JSON.stringify(fromEditor(editor.getJSON(), fallback)) !==
      JSON.stringify(element.paragraphs)
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
