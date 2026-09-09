import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  EditorContent,
  useEditor,
  type Editor,
  type JSONContent,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { editorExtensions } from "./editorExtensions";
import { EditorToolbar } from "./EditorToolbar";
import { useFileUploads } from "./useFileUploads";
import { attachmentAccept } from "./AttachmentNode";
import "./attachments.css";
import "katex/dist/katex.min.css";
import "./editor.css";

export function RichEditor({
  document,
  onChange,
  onReady,
  beforeContent,
  readOnly = false,
}: {
  beforeContent?: ReactNode;
  readOnly?: boolean;
  document: JSONContent;
  onChange: (document: JSONContent) => void;
  onReady: (editor: Editor) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const attachmentFile = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{
    kind: "link" | "math";
    value: string;
    pos?: number;
    inline?: boolean;
  } | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const ready = useRef(onReady);
  ready.current = onReady;
  const uploadRef = useRef<(files: File[], position?: number) => void>(
    () => {},
  );
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: editorExtensions((latex, pos, inline) => {
      if (!readOnly) setDialog({ kind: "math", value: latex, pos, inline });
    }, readOnly),
    content: document,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: "thought-prose",
        "aria-label": "笔记正文",
        role: "textbox",
        "aria-multiline": "true",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        uploadRef.current(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        uploadRef.current(
          files,
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos,
        );
        return true;
      },
      transformPastedHTML: (html) => {
        const parsed = new DOMParser().parseFromString(html, "text/html");
        parsed
          .querySelectorAll("script,iframe,object,embed,style,img")
          .forEach((node) => node.remove());
        parsed.querySelectorAll("*").forEach((node) =>
          Array.from(node.attributes).forEach((attr) => {
            if (attr.name.startsWith("on") || attr.name.startsWith("data-"))
              node.removeAttribute(attr.name);
          }),
        );
        return parsed.body.innerHTML;
      },
      handleDOMEvents: {
        compositionend: (view) => {
          setTimeout(() => {
            if (!view.isDestroyed) callback.current(view.state.doc.toJSON());
          }, 0);
          return false;
        },
      },
    },
    onUpdate: ({ editor: current }) => {
      if (!current.view.composing) callback.current(current.getJSON());
    },
  });
  useEffect(() => {
    if (editor && !editor.isDestroyed) ready.current(editor);
  }, [editor]);
  useEffect(() => {
    if (
      editor &&
      !editor.isDestroyed &&
      !editor.view.composing &&
      JSON.stringify(editor.getJSON()) !== JSON.stringify(document)
    )
      editor.commands.setContent(document, { emitUpdate: false });
  }, [editor, document]);
  useEffect(() => {
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);
  const uploads = useFileUploads(editor);
  uploadRef.current = readOnly ? () => {} : uploads.enqueue;
  if (!editor) return <p>编辑器加载中…</p>;
  const link = () =>
    setDialog({ kind: "link", value: editor.getAttributes("link").href || "" });
  return (
    <div className="thought-rich-editor">
      {!readOnly && (
        <EditorToolbar
          editor={editor}
          onImage={() => file.current?.click()}
          onAttachment={() => attachmentFile.current?.click()}
          onLink={link}
          onMath={(inline) => setDialog({ kind: "math", value: "", inline })}
        />
      )}
      <input
        hidden
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        onChange={(e) => {
          uploadRef.current(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={attachmentFile}
        aria-label="选择附件"
        type="file"
        accept={attachmentAccept}
        multiple
        onChange={(e) => {
          uploadRef.current(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      {!!uploads.entries.length && (
        <div className="thought-upload-list" aria-label="文件上传状态">
          {uploads.entries.map((entry) => (
            <div
              key={entry.id}
              role={entry.status === "failed" ? "alert" : "status"}
            >
              <span>
                {entry.file.name} ·{" "}
                {entry.status === "failed"
                  ? entry.error
                  : entry.status === "waiting"
                    ? "等待上传"
                    : "上传中…"}
              </span>
              {entry.status === "failed" && (
                <>
                  <button onClick={() => uploads.retry(entry.id)}>重试</button>
                  <button onClick={() => uploads.dismiss(entry.id)}>
                    移除
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="thought-error">
          {error}
        </p>
      )}
      {beforeContent}
      <EditorContent editor={editor} />
      {!readOnly && (
        <BubbleMenu editor={editor} className="thought-bubble">
          <button onClick={() => editor.chain().focus().toggleBold().run()}>
            粗体
          </button>
          <button
            onClick={() =>
              editor.chain().focus().toggleHighlight({ color: "#edc36c" }).run()
            }
          >
            高亮
          </button>
          <button onClick={link}>链接</button>
        </BubbleMenu>
      )}
      <TextInputDialog
        open={!!dialog}
        title={dialog?.kind === "link" ? "添加链接" : "编辑公式"}
        label={dialog?.kind === "link" ? "链接地址（https://…）" : "LaTeX 公式"}
        initialValue={dialog?.value || ""}
        onCancel={() => setDialog(null)}
        onConfirm={(value) => {
          if (dialog?.kind === "link") {
            if (!/^(https?:\/\/|mailto:)/i.test(value)) {
              setError("请输入 http、https 或 mailto 链接");
              return;
            }
            editor
              .chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href: value })
              .run();
          } else if (dialog) {
            if (dialog.pos !== undefined) {
              if (dialog.inline)
                editor
                  .chain()
                  .focus()
                  .updateInlineMath({ latex: value, pos: dialog.pos })
                  .run();
              else
                editor
                  .chain()
                  .focus()
                  .updateBlockMath({ latex: value, pos: dialog.pos })
                  .run();
            } else if (dialog.inline)
              editor.chain().focus().insertInlineMath({ latex: value }).run();
            else editor.chain().focus().insertBlockMath({ latex: value }).run();
          }
          setDialog(null);
        }}
      />
    </div>
  );
}
