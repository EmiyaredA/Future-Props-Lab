import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  LoaderCircle,
  ListTree,
  Pin,
  Star,
  Sparkles,
} from "lucide-react";
import { NoteTags } from "./NoteTags";
import type { Editor, JSONContent } from "@tiptap/react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { useNoteDraft } from "./useNoteDraft";
import type { Note } from "./api";
import { WritingAssistant } from "./WritingAssistant";
import { exportHtml, exportMarkdown } from "./portability";
import { markdownWarnings, toMarkdown } from "./markdown";

const RichEditor = lazy(() =>
  import("./RichEditor").then((m) => ({ default: m.RichEditor })),
);
export type NavigationGuard = (
  guard: ((proceed: () => void) => boolean) | null,
) => void;
export function NoteEditorPane({
  note,
  onSaved,
  onOpen,
  onModels,
  registerNavigationGuard,
  onDirectory,
}: {
  note: Note;
  onSaved: (note: Note) => void;
  onOpen: (id: string) => void;
  onModels: () => void;
  registerNavigationGuard: NavigationGuard;
  onDirectory: () => void;
}) {
  const editing = useNoteDraft(note, onSaved);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [assistant, setAssistant] = useState(false);
  const [notice, setNotice] = useState("");
  const [serverPreview, setServerPreview] = useState(false);
  const [exportWarnings, setExportWarnings] = useState<string[] | null>(null);
  const [leave, setLeave] = useState(false);
  const continuation = useRef<(() => void) | null>(null);
  const current = useRef(editing);
  current.current = editing;
  useEffect(() => {
    registerNavigationGuard((proceed) => {
      if (!current.current.isDirty()) return false;
      continuation.current = proceed;
      setLeave(true);
      return true;
    });
    return () => registerNavigationGuard(null);
  }, [registerNavigationGuard]);
  const save = async () => {
    let latest = await editing.flush();
    while (editing.isDirty()) latest = await editing.flush();
    return latest;
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void current.current.flush().catch(() => {});
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const exportNote = async (format: string) => {
    try {
      const saved = await save();
      if (format === "html" && editor) await exportHtml(saved, editor);
      if (format === "markdown") {
        const warnings = markdownWarnings(saved.document as JSONContent);
        if (warnings.length) setExportWarnings(warnings);
        else await exportMarkdown(saved);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "导出失败");
    }
  };
  return (
    <div
      className={`thought-edit-workspace ${assistant ? "has-assistant" : ""}`}
    >
      <section className="thought-document">
        <header className="thought-document-bar">
          <button
            className="btn thought-directory-toggle"
            onClick={onDirectory}
          >
            <ListTree size={17} aria-hidden="true" /> 笔记目录
          </button>
          <span
            role="status"
            className={`thought-save-state is-${editing.state}`}
          >
            {editing.state === "saved" ? (
              <Check size={15} aria-hidden="true" />
            ) : editing.state === "saving" ? (
              <LoaderCircle size={15} aria-hidden="true" />
            ) : (
              <CircleAlert size={15} aria-hidden="true" />
            )}
            {
              {
                saved: "已保存",
                dirty: "未保存",
                saving: "保存中…",
                error: "保存失败",
                conflict: "保存冲突",
              }[editing.state]
            }
          </span>
          <button
            className="btn"
            onClick={() => void save().catch(() => {})}
            disabled={
              editing.state === "saving" || editing.state === "conflict"
            }
          >
            保存
          </button>
          <CustomSelect
            ariaLabel="导出笔记"
            value=""
            options={[
              { value: "", label: "导出", disabled: true },
              { value: "html", label: "HTML 离线阅读" },
              { value: "markdown", label: "Markdown" },
            ]}
            onChange={(v) => void exportNote(v)}
          />
          <button
            className="btn primary thought-ai-toggle"
            aria-pressed={assistant}
            onClick={() => setAssistant(!assistant)}
          >
            <Sparkles size={16} aria-hidden="true" /> AI 写作
          </button>
        </header>
        {(editing.error || notice) && (
          <p className="thought-error" role="alert">
            {editing.error || notice}
          </p>
        )}
        {editing.state === "conflict" && (
          <div className="thought-conflict" role="alert">
            <strong>笔记已在其他地方更新，本地内容已保留。</strong>
            <div className="thought-actions">
              {editing.conflict && (
                <>
                  <button
                    className="btn"
                    onClick={() => setServerPreview(!serverPreview)}
                  >
                    查看服务器版本
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      editing.adopt(editing.conflict!);
                      setServerPreview(false);
                    }}
                  >
                    采用服务器版本
                  </button>
                </>
              )}
              <button
                className="btn primary"
                onClick={() =>
                  void editing
                    .duplicate()
                    .then((copy) => {
                      editing.adopt(copy);
                      onSaved(copy);
                      onOpen(copy.id);
                    })
                    .catch((e) => setNotice(e.message))
                }
              >
                另存本地副本
              </button>
            </div>
            {serverPreview && editing.conflict && (
              <div>
                <h3>{editing.conflict.title}</h3>
                <pre>{toMarkdown(editing.conflict.document, {})}</pre>
              </div>
            )}
          </div>
        )}
        <Suspense fallback={<p>编辑器加载中…</p>}>
          <RichEditor
            document={editing.draft.document as JSONContent}
            onChange={(document) => editing.change({ document })}
            onReady={setEditor}
            beforeContent={
              <div className="thought-note-heading">
                <div className="thought-note-meta">
                  <button
                    className="thought-pin"
                    aria-label="置顶"
                    title="置顶"
                    aria-pressed={!!editing.draft.pinned}
                    onClick={() =>
                      editing.change({ pinned: !editing.draft.pinned })
                    }
                  >
                    <Pin size={19} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="收藏"
                    title="收藏"
                    aria-pressed={!!editing.draft.favorite}
                    onClick={() =>
                      editing.change({ favorite: !editing.draft.favorite })
                    }
                  >
                    <Star size={19} aria-hidden="true" />
                  </button>
                </div>
                <input
                  className="thought-title-input"
                  aria-label="笔记标题"
                  maxLength={240}
                  value={editing.draft.title || ""}
                  placeholder="未命名笔记"
                  onChange={(e) =>
                    editing.change({ title: e.target.value || "未命名笔记" })
                  }
                />
                <NoteTags
                  tags={editing.draft.tags || []}
                  onChange={(tags) => editing.change({ tags })}
                />
              </div>
            }
          />
        </Suspense>
        <footer className="thought-document-footer">专注于眼前的想法</footer>
      </section>
      {assistant && (
        <WritingAssistant
          editor={editor}
          save={save}
          onModels={onModels}
          close={() => setAssistant(false)}
        />
      )}
      <ConfirmDialog
        open={leave}
        title="仍有未保存的内容"
        description="保存成功后再离开；也可以取消并继续编辑。"
        confirmLabel="保存并离开"
        cancelLabel="继续编辑"
        onCancel={() => setLeave(false)}
        onConfirm={async () => {
          try {
            await save();
            setLeave(false);
            continuation.current?.();
          } catch {
            setLeave(false);
          }
        }}
      />
      <ConfirmDialog
        open={exportWarnings !== null}
        title="Markdown 格式转换"
        description={<span>{exportWarnings?.join(" ")}</span>}
        confirmLabel="继续导出"
        onCancel={() => setExportWarnings(null)}
        onConfirm={async () => {
          setExportWarnings(null);
          try {
            await exportMarkdown(await save());
          } catch (e) {
            setNotice(e instanceof Error ? e.message : "导出失败");
          }
        }}
      />
    </div>
  );
}
