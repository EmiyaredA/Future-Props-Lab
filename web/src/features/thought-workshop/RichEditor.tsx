import { LoadingState } from "@shared/ui/LoadingState";
import { Search, TextSearch, Link2 } from "lucide-react";
import { KnowledgeActionMenu } from "./KnowledgeActionMenu";
import { useDocumentAccess } from "./DocumentAccess";
import { NavigationScope } from "./document-layout/NavigationScope";
import "./document-layout/prose.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  EditorContent,
  useEditor,
  type Editor,
  type JSONContent,
} from "@tiptap/react";
import { useReadingPosition } from "./knowledge-tools/ReadingPosition";
import { ReferencePicker } from "./knowledge-tools/ReferencePicker";
import { referenceTrigger } from "./knowledge-tools/ContentNodes";
import { FindDecorations, FindPanel } from "./knowledge-tools/Find";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { TextSelection } from "@tiptap/pm/state";
import { editorExtensions } from "./editorExtensions";
import { useFileUploads } from "./useFileUploads";
import { attachmentAccept } from "./AttachmentNode";
import { BlockEditorChrome } from "./BlockEditorChrome";
import { EditorContextMenus } from "./EditorContextMenus";
import { LinkPreviewCard } from "./LinkPreviewCard";
import { DocumentOutline } from "./DocumentOutline.tsx";
import type { DocumentChrome } from "./document-layout/useDocumentChrome";
import type { InsertCallbacks } from "./blockCommands";
import {
  clearSessionThoughtClipboard,
  htmlNeedsManagedMigration,
  insertThoughtClipboardPayload,
  pasteThoughtHTML,
  peekSessionThoughtClipboard,
  readThoughtClipboardPayload,
  sanitizeThoughtPastedHTML,
  ThoughtClipboardFormatError,
  writeThoughtClipboard,
} from "./clipboard";
import "./attachments.css";
import "katex/dist/katex.min.css";
import "./editor.css";
import "./document-layout/reading.css";
import "./block-editor.css";
import { HistoryDecorations, historyDecorationKey } from "./HistoryDecorations";
import type { HistoryMark } from "./historyDiff";

export function RichEditor({
  document,
  onChange,
  onReady,
  beforeContent,
  outlineTitle,
  documentChrome,
  readOnly = false,
  historyMarks,
  historyAuthor = "",
  onCompositionChange,
  onBackspaceAtStart,
  assetScopeId,
  readingId,
  readingRevision,
  libraryId = "",
  official = false,
  onNavigateHref,
}: {
  onBackspaceAtStart?: () => boolean;
  assetScopeId?: string;
  readingId?: string;
  readingRevision?: number;
  libraryId?: string;
  official?: boolean;
  onNavigateHref?: (href: string) => void;
  historyMarks?: HistoryMark[];
  historyAuthor?: string;
  onCompositionChange?: (active: boolean) => void;
  beforeContent?: ReactNode;
  outlineTitle?: string;
  documentChrome?: DocumentChrome;
  readOnly?: boolean;
  document: JSONContent;
  onChange: (document: JSONContent) => void;
  onReady: (editor: Editor) => void;
}) {
  const access = useDocumentAccess();
  const [outlineDocked, setOutlineDocked] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const attachmentFile = useRef<HTMLInputElement>(null);
  const uploadPosition = useRef<number | undefined>(undefined);
  const canvas = useRef<HTMLDivElement>(null);
  const [find, setFind] = useState<"find" | "replace" | null>(() =>
    new URLSearchParams(location.search).has("find") ? "find" : null,
  );
  const [referenceRange, setReferenceRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{
    kind: "link" | "math";
    value: string;
    pos?: number;
    insertAt?: number;
    inline?: boolean;
  } | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const compositionCallback = useRef(onCompositionChange);
  compositionCallback.current = onCompositionChange;
  const backspaceAtStart = useRef(onBackspaceAtStart);
  backspaceAtStart.current = onBackspaceAtStart;
  const ready = useRef(onReady);
  ready.current = onReady;
  const editorRef = useRef<Editor | null>(null);
  const uploadRef = useRef<(files: File[], position?: number) => void>(
    () => {},
  );
  const insertCallbacks = useRef<InsertCallbacks>({
    image: (position) => {
      uploadPosition.current = position;
      file.current?.click();
    },
    attachment: (position) => {
      uploadPosition.current = position;
      attachmentFile.current?.click();
    },
    math: (inline, position) =>
      setDialog({ kind: "math", value: "", inline, insertAt: position }),
  });
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      ...editorExtensions(
        (latex, pos, inline) => {
          if (!readOnly) setDialog({ kind: "math", value: latex, pos, inline });
        },
        readOnly,
        insertCallbacks.current,
      ),
      HistoryDecorations,
      FindDecorations,
      ...(!readOnly ? [referenceTrigger(setReferenceRange)] : []),
    ],
    content: document,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: "thought-prose document-prose",
        "aria-label": "笔记正文",
        role: "textbox",
        "aria-multiline": "true",
        "aria-readonly": String(readOnly),
      },
      handleKeyDown: (view, event) => {
        if (
          !view.editable ||
          view.composing ||
          event.isComposing ||
          event.key !== "Backspace" ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return false;
        const domSelection = view.dom.ownerDocument.getSelection();
        if (
          domSelection &&
          !domSelection.isCollapsed &&
          view.dom.contains(domSelection.anchorNode) &&
          view.dom.contains(domSelection.focusNode)
        )
          return false;
        const selection = view.state.selection;
        // Leave block unwrapping and selected-content deletion to the editor.
        if (
          !(selection instanceof TextSelection) ||
          !selection.$cursor ||
          selection.$cursor.pos !== 1 ||
          selection.$cursor.parent.type.name !== "paragraph"
        )
          return false;
        return backspaceAtStart.current?.() ?? false;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        const html = event.clipboardData?.getData("text/html") || "";
        const text = event.clipboardData?.getData("text/plain") || "";
        const currentEditor = editorRef.current;
        if (!currentEditor) return false;

        const reportPasteError = (error: unknown) => {
          if (error instanceof ThoughtClipboardFormatError && html) {
            void pasteThoughtHTML(currentEditor, html, assetScopeId, access)
              .then(() => setError(""))
              .catch((fallbackError: Error) => setError(fallbackError.message));
            return;
          }
          setError(
            error instanceof Error ? error.message : "粘贴失败，请重试。",
          );
        };

        const sessionPayload = peekSessionThoughtClipboard();
        const needsHtmlMigration = htmlNeedsManagedMigration(
          html,
          assetScopeId,
        );
        const looksManagedHtml =
          /data-thought-image|data-asset-id|data-fpl-source-scope/i.test(html);
        const emptyClipboardEvent = !html && !text && files.length === 0;

        if (!needsHtmlMigration && !looksManagedHtml) {
          if (sessionPayload && emptyClipboardEvent) {
            event.preventDefault();
            void insertThoughtClipboardPayload(
              currentEditor,
              sessionPayload,
              assetScopeId,
              access,
            )
              .then(() => setError(""))
              .catch(reportPasteError);
            return true;
          }
          if (sessionPayload) clearSessionThoughtClipboard();
          if (files.length) {
            event.preventDefault();
            uploadRef.current(files);
            return true;
          }
          return false;
        }

        event.preventDefault();
        void (async () => {
          try {
            const fromClipboard = await readThoughtClipboardPayload();
            if (fromClipboard) {
              await insertThoughtClipboardPayload(
                currentEditor,
                fromClipboard,
                assetScopeId,
                access,
              );
              setError("");
              return;
            }
            const session = peekSessionThoughtClipboard();
            if (session) {
              await insertThoughtClipboardPayload(
                currentEditor,
                session,
                assetScopeId,
                access,
              );
              setError("");
              return;
            }
            if (htmlNeedsManagedMigration(html, assetScopeId)) {
              await pasteThoughtHTML(currentEditor, html, assetScopeId, access);
              setError("");
              return;
            }
            if (files.length) {
              uploadRef.current(files);
              setError("");
              return;
            }
            if (html) {
              currentEditor.commands.insertContent(
                sanitizeThoughtPastedHTML(html, assetScopeId),
              );
            } else if (text) {
              currentEditor.commands.insertContent(text);
            }
            setError("");
          } catch (error) {
            reportPasteError(error);
          }
        })();
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
        return sanitizeThoughtPastedHTML(html, assetScopeId);
      },
      handleDOMEvents: {
        copy: (view) => {
          if (!view.editable) return false;
          const currentEditor = editorRef.current;
          if (!currentEditor) return false;
          void writeThoughtClipboard(currentEditor, assetScopeId, access).catch(
            (error: Error) => setError(error.message),
          );
          return true;
        },
        compositionstart: () => {
          compositionCallback.current?.(true);
          return false;
        },
        compositionend: (view) => {
          setTimeout(() => {
            if (!view.isDestroyed) callback.current(view.state.doc.toJSON());
            compositionCallback.current?.(false);
          }, 0);
          return false;
        },
      },
    },
    onUpdate: ({ editor: current, transaction }) => {
      if (transaction.docChanged && !current.view.composing)
        callback.current(current.getJSON());
    },
  });
  editorRef.current = editor;
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
    if (editor && !editor.isDestroyed)
      editor.view.dispatch(
        editor.state.tr.setMeta(historyDecorationKey, {
          marks: readOnly ? (historyMarks ?? []) : [],
          author: historyAuthor,
        }),
      );
  }, [editor, document, readOnly, historyMarks, historyAuthor]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!readOnly, false);
    editor.view.dom.setAttribute("aria-readonly", String(readOnly));
  }, [editor, readOnly]);
  const reading = useReadingPosition(
    readingId,
    outlineTitle ?? "文档",
    readingRevision ?? null,
    !!editor,
  );
  const uploads = useFileUploads(editor);
  uploadRef.current = readOnly ? () => {} : uploads.enqueue;
  if (!editor) return <LoadingState label="编辑器加载中…" variant="region" />;
  const link = () =>
    setDialog({ kind: "link", value: editor.getAttributes("link").href || "" });
  return (
    <div
      ref={(node) => {
        reading.current = node;
      }}
      className={`thought-rich-editor${outlineDocked ? " has-docked-outline" : ""}`}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          ["f", "h"].includes(event.key.toLowerCase()) &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          setFind(
            event.key.toLowerCase() === "h" && !readOnly ? "replace" : "find",
          );
        }
      }}
    >
      {outlineTitle !== undefined ? (
        <DocumentOutline
          key={readingId}
          editor={editor}
          title={outlineTitle}
          chrome={documentChrome}
          onDockChange={setOutlineDocked}
          tools={
            <div className="thought-tools">
              <button
                className="btn small"
                aria-label="文内查找"
                onClick={() => setFind("find")}
              >
                <Search size={15} aria-hidden />
                查找
              </button>
              {!readOnly && (
                <KnowledgeActionMenu
                  ariaLabel="正文工具"
                  groups={[
                    [
                      { value: "replace", label: "查找替换", icon: TextSearch },
                      { value: "reference", label: "引用文档", icon: Link2 },
                    ],
                  ]}
                  onAction={(value) =>
                    value === "replace"
                      ? setFind("replace")
                      : setReferenceRange({
                          from: editor.state.selection.from,
                          to: editor.state.selection.to,
                        })
                  }
                />
              )}
            </div>
          }
        />
      ) : (
        <div className="thought-tools">
          <button
            className="btn small"
            aria-label="文内查找"
            onClick={() => setFind("find")}
          >
            <Search size={15} aria-hidden />
            查找
          </button>
          {!readOnly && (
            <KnowledgeActionMenu
              ariaLabel="正文工具"
              groups={[
                [
                  { value: "replace", label: "查找替换", icon: TextSearch },
                  { value: "reference", label: "引用文档", icon: Link2 },
                ],
              ]}
              onAction={(value) =>
                value === "replace"
                  ? setFind("replace")
                  : setReferenceRange({
                      from: editor.state.selection.from,
                      to: editor.state.selection.to,
                    })
              }
            />
          )}
        </div>
      )}
      {find && (
        <FindPanel
          editor={editor}
          replace={find === "replace"}
          close={() => setFind(null)}
        />
      )}
      {referenceRange && (
        <ReferencePicker
          close={() => setReferenceRange(null)}
          choose={(attrs) => {
            editor
              .chain()
              .focus()
              .insertContentAt(referenceRange, {
                type: "documentReference",
                attrs,
              })
              .run();
            setReferenceRange(null);
          }}
        />
      )}
      <input
        hidden
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        onChange={(e) => {
          uploadRef.current(
            Array.from(e.target.files || []),
            uploadPosition.current,
          );
          uploadPosition.current = undefined;
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
          uploadRef.current(
            Array.from(e.target.files || []),
            uploadPosition.current,
          );
          uploadPosition.current = undefined;
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
                {entry.status === "failed" ? (
                  entry.error
                ) : entry.status === "waiting" ? (
                  "等待上传"
                ) : (
                  <LoadingState
                    variant="inline"
                    label="上传中…"
                    progress={entry.progress}
                  />
                )}
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
      <NavigationScope
        libraryId={libraryId}
        official={official}
        document={document}
        navigate={onNavigateHref}
      >
        <div ref={canvas} className="thought-editor-canvas">
          <EditorContent editor={editor} />
          <LinkPreviewCard editor={editor} />
          <BlockEditorChrome
            editor={editor}
            canvas={canvas}
            callbacks={insertCallbacks.current}
            onError={setError}
            readOnly={readOnly}
            assetScopeId={assetScopeId}
          />
        </div>
      </NavigationScope>
      {!readOnly ? <EditorContextMenus editor={editor} onLink={link} /> : null}
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
            } else {
              const chain = editor.chain().focus();
              if (dialog.insertAt !== undefined)
                chain.setTextSelection(
                  Math.min(dialog.insertAt, editor.state.doc.content.size),
                );
              if (dialog.inline) chain.insertInlineMath({ latex: value }).run();
              else chain.insertBlockMath({ latex: value }).run();
            }
          }
          setDialog(null);
        }}
      />
    </div>
  );
}
