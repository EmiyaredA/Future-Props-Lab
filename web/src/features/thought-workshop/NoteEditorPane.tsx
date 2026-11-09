import { LoadingState } from "@shared/ui/LoadingState";
import { useDocumentAccess } from "./DocumentAccess";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Pin, Star } from "lucide-react";
import { NoteTags } from "./NoteTags";
import type { Editor, JSONContent } from "@tiptap/react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { useNoteDraft } from "./useNoteDraft";
import type { Note } from "./api";
import { exportHtml, exportMarkdown } from "./portability";
import { markdownWarnings, toMarkdown } from "./markdown";
import type { NoteEditorChrome } from "./noteEditorChrome";
import type { DocumentChrome } from "./document-layout/useDocumentChrome";
import { useAccountId } from "@platform/auth/AccountAccess";

const NoteHistory = lazy(() =>
  import("./NoteHistory").then((m) => ({ default: m.NoteHistory })),
);

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
  registerNavigationGuard,
  onChromeChange,
  onNavigateHref,
  documentChrome,
}: {
  note: Note;
  onSaved: (note: Note) => void;
  onOpen: (id: string) => void;
  registerNavigationGuard: NavigationGuard;
  onChromeChange?: (chrome: NoteEditorChrome | null) => void;
  onNavigateHref?: (href: string) => void;
  documentChrome?: DocumentChrome;
}) {
  const access = useDocumentAccess();
  const editing = useNoteDraft(note, onSaved);
  const workspace = useAccountId();
  const recoveryPending = !editing.localReady || !!editing.recovery.length;
  const [editor, setEditor] = useState<Editor | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");
  const [serverPreview, setServerPreview] = useState(false);
  const [exportWarnings, setExportWarnings] = useState<string[] | null>(null);
  const [leave, setLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [historyNote, setHistoryNote] = useState<Note | null>(null);
  const leaveFlight = useRef(false);
  const continuation = useRef<(() => void) | null>(null);
  const current = useRef(editing);
  current.current = editing;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const save = async () => {
    let latest = await current.current.flush();
    while (current.current.isDirty()) latest = await current.current.flush();
    return latest;
  };
  const finishNavigation = async () => {
    if (leaveFlight.current) return;
    leaveFlight.current = true;
    setLeaving(true);
    try {
      await save();
      const proceed = continuation.current;
      continuation.current = null;
      setLeave(false);
      proceed?.();
    } catch {
      setLeave(true);
    } finally {
      leaveFlight.current = false;
      setLeaving(false);
    }
  };
  const navigation = useRef(finishNavigation);
  navigation.current = finishNavigation;
  useEffect(() => {
    registerNavigationGuard((proceed) => {
      if (leaveFlight.current || continuation.current) return true;
      if (!current.current.isDirty()) return false;
      continuation.current = proceed;
      void navigation.current();
      return true;
    });
    return () => registerNavigationGuard(null);
  }, [registerNavigationGuard]);
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
      if (format === "html" && editorRef.current)
        await exportHtml(saved, editorRef.current, access.assetUrl, access);
      if (format === "markdown") {
        const warnings = markdownWarnings(saved.document as JSONContent);
        if (warnings.length) setExportWarnings(warnings);
        else await exportMarkdown(saved, access.assetUrl, access);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "导出失败");
    }
  };
  const closeHistory = () => {
    setHistoryNote(null);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[aria-label="笔记更多操作"]')
        ?.focus();
    });
  };
  const openHistory = () => {
    void save()
      .then((next) => {
        setHistoryNote(next);
      })
      .catch(() => {});
  };
  const chromeActions = useRef({
    save,
    openHistory,
    exportNote: (format: string) => void exportNote(format),
  });
  chromeActions.current = {
    save,
    openHistory,
    exportNote: (format: string) => void exportNote(format),
  };
  useEffect(() => {
    if (!onChromeChange) return;
    onChromeChange({
      state: editing.state,
      savedAt: editing.savedAt,
      save: () => chromeActions.current.save(),
      openHistory: () => chromeActions.current.openHistory(),
      exportNote: (format) => chromeActions.current.exportNote(format),
      canSave: editing.state !== "saving" && editing.state !== "conflict",
      canOpenHistory:
        access.canViewHistory && !leaving && editing.state !== "conflict",
    });
  }, [
    onChromeChange,
    editing.state,
    editing.savedAt,
    leaving,
    access.canViewHistory,
  ]);
  useEffect(() => {
    if (!onChromeChange) return;
    return () => onChromeChange(null);
  }, [onChromeChange]);
  if (historyNote)
    return (
      <Suspense
        fallback={<LoadingState label="历史记录加载中…" variant="region" />}
      >
        <NoteHistory
          note={historyNote}
          close={closeHistory}
          restored={(next) => {
            editing.adopt(next);
            onSaved(next);
            closeHistory();
          }}
          conflict={(server) => {
            editing.markConflict(server);
            closeHistory();
          }}
        />
      </Suspense>
    );
  return (
    <div className="thought-edit-workspace">
      <section className="thought-document">
        {editing.localError && (
          <p role="alert" className="thought-error">
            {editing.localError}
          </p>
        )}
        {!!editing.recovery.length && (
          <div className="thought-conflict" role="alert">
            <strong>发现未保存的本机草稿，请选择恢复方式。</strong>
            {editing.recovery.map((row) => (
              <div key={row.key}>
                <p>
                  {row.body.title} · {new Date(row.updatedAt).toLocaleString()}
                </p>
                <button
                  className="btn"
                  onClick={() => void editing.restoreLocal(row)}
                >
                  恢复草稿
                </button>
                <button
                  className="btn"
                  onClick={() => setServerPreview(!serverPreview)}
                >
                  查看服务端
                </button>
                {access.duplicate && (
                  <button
                    className="btn"
                    onClick={() =>
                      void editing
                        .duplicateLocal(row)
                        .then((next) => onOpen(next.id))
                        .catch((error) => setNotice(String(error)))
                    }
                  >
                    另存副本
                  </button>
                )}
                <button
                  className="btn"
                  onClick={() => void editing.discardLocal(row)}
                >
                  丢弃草稿
                </button>
              </div>
            ))}
          </div>
        )}
        {(editing.error || notice) && (
          <p className="thought-error" role="alert">
            {editing.error || notice}
          </p>
        )}
        {leaving && (
          <LoadingState
            label="正在保存，完成后离开…"
            variant="region"
            className="thought-navigation-status"
          />
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
              {access.duplicate && (
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
              )}
            </div>
          </div>
        )}
        {serverPreview && (
          <div className="thought-conflict">
            <h3>{(editing.conflict ?? note).title}</h3>
            <pre>{toMarkdown((editing.conflict ?? note).document, {})}</pre>
          </div>
        )}
        {recoveryPending ? (
          <p role="status">
            {!editing.localReady ? (
              <LoadingState variant="inline" label="正在检查本机草稿…" />
            ) : (
              "请选择本机草稿的恢复方式…"
            )}
          </p>
        ) : (
          <Suspense
            fallback={<LoadingState label="编辑器加载中…" variant="region" />}
          >
            <RichEditor
              documentChrome={documentChrome}
              libraryId={note.knowledge_base_id}
              onNavigateHref={onNavigateHref}
              outlineTitle={editing.draft.title}
              assetScopeId={
                access.community
                  ? `${access.namespace}/${note.id}`
                  : (workspace ?? undefined)
              }
              onBackspaceAtStart={() => {
                const title = titleInput.current;
                if (!title) return false;
                title.focus();
                title.setSelectionRange(title.value.length, title.value.length);
                return true;
              }}
              onCompositionChange={editing.setComposition}
              readingId={
                access.community ? `${access.namespace}/${note.id}` : note.id
              }
              readingRevision={note.revision}
              document={editing.draft.document as JSONContent}
              onChange={(document) => editing.change({ document })}
              onReady={setEditor}
              beforeContent={
                <div className="thought-note-heading">
                  {!access.community && (
                    <div className="thought-note-meta">
                      <button
                        className="thought-pin"
                        aria-label="置顶"
                        disabled={recoveryPending}
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
                        disabled={recoveryPending}
                        title="收藏"
                        aria-pressed={!!editing.draft.favorite}
                        onClick={() =>
                          editing.change({ favorite: !editing.draft.favorite })
                        }
                      >
                        <Star size={19} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  <input
                    ref={titleInput}
                    className="thought-title-input"
                    data-amadeus-id={note.id}
                    aria-label="笔记标题"
                    disabled={recoveryPending}
                    maxLength={240}
                    value={editing.titleInput ?? editing.draft.title}
                    placeholder="未命名笔记"
                    onFocus={() => editing.setTitleInput(editing.draft.title)}
                    onCompositionStart={() => editing.setComposition(true)}
                    onCompositionEnd={() => editing.setComposition(false)}
                    onChange={(event) => {
                      const next = event.target.value;
                      editing.setTitleInput(next);
                      if (next.trim()) editing.change({ title: next });
                    }}
                    onBlur={() => editing.setTitleInput(null)}
                  />
                  <NoteTags
                    tags={editing.draft.tags || []}
                    disabled={recoveryPending}
                    onDraft={(tags) => editing.change({ tags })}
                    onComposition={editing.setComposition}
                    onChange={(tags) => editing.change({ tags })}
                  />
                </div>
              }
            />
          </Suspense>
        )}
        <footer className="thought-document-footer">专注于眼前的想法</footer>
      </section>
      <ConfirmDialog
        open={leave}
        title="仍有未保存的内容"
        description={
          <div>
            {editing.error || "保存成功后再离开；也可以继续编辑。"}
            {access.community && (
              <button
                className="btn"
                onClick={() => {
                  const proceed = continuation.current;
                  continuation.current = null;
                  setLeave(false);
                  proceed?.();
                }}
              >
                保留本机草稿并离开
              </button>
            )}
          </div>
        }
        confirmLabel="重试保存并离开"
        cancelLabel="继续编辑"
        pending={leaving}
        onCancel={() => {
          continuation.current = null;
          setLeave(false);
        }}
        onConfirm={finishNavigation}
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
            await exportMarkdown(await save(), access.assetUrl, access);
          } catch (e) {
            setNotice(e instanceof Error ? e.message : "导出失败");
          }
        }}
      />
    </div>
  );
}
