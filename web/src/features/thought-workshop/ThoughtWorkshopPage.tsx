import type { JSONContent } from "@tiptap/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Search } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { KnowledgeSidebar } from "./KnowledgeSidebar";
import { OfficialLibraryCards } from "./official/OfficialLibraryCards";
import { ProjectLibraryCard } from "@shared/ui/project-library/ProjectLibraryCard";
import {
  deleteNote,
  downloadBackup,
  getNote,
  restoreNote,
  uploadImage,
  type KnowledgeBase,
  type Note,
} from "./api";
import {
  createKnowledge,
  createDocument,
  getDirectory,
  listKnowledge,
  moveEntry,
  restoreKnowledge,
  trashKnowledge,
  updateKnowledge,
} from "./knowledgeApi";
import { KnowledgeTree } from "./KnowledgeTree";
import { KnowledgeCover } from "./KnowledgeCover";
import { KnowledgeDocumentResults } from "./KnowledgeDocumentResults";
import { DeleteDocumentDialog } from "./DeleteDocumentDialog";
import { KnowledgeTopbar } from "./KnowledgeTopbar";
import { useNoteResults } from "./useNoteResults";
import { thoughtKeys } from "./queryKeys";
import { download } from "./download";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import type { NavigationGuard } from "./NoteEditorPane";
import type { NoteEditorChrome } from "./noteEditorChrome";
import type { NoteSummary } from "./api";
import "./thought-workshop.css";
import "./writing-layout.css";
import "./knowledge.css";
const NoteEditorPane = lazy(() =>
  import("./NoteEditorPane").then((m) => ({ default: m.NoteEditorPane })),
);
const RichEditor = lazy(() =>
  import("./RichEditor").then((m) => ({ default: m.RichEditor })),
);

type Input = {
  title: string;
  initial?: string;
  apply: (value: string) => Promise<unknown>;
};
export function ThoughtWorkshopPage({
  page,
  projectId,
  noteId,
  onNavigate,
  onBack,
  registerNavigationGuard,
  onOpenOfficial,
}: {
  page: string;
  projectId?: string;
  noteId?: string;
  onNavigate: (project?: string, document?: string, replace?: boolean) => void;
  onBack: () => void;
  registerNavigationGuard: NavigationGuard;
  onOpenOfficial: (libraryId: string) => void;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [trash, setTrash] = useState(false);
  const [view, setView] = useState("all");
  const [browsing, setBrowsing] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const operationQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingOperations = useRef(0);
  const [input, setInput] = useState<Input | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    apply: () => Promise<unknown>;
  } | null>(null);
  const [moving, setMoving] = useState<NoteSummary | null>(null);
  const [moveParent, setMoveParent] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<NoteSummary | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [editHome, setEditHome] = useState(false);
  const [coverProject, setCoverProject] = useState<KnowledgeBase | null>(null);
  const [noteChrome, setNoteChrome] = useState<NoteEditorChrome | null>(null);
  const onNoteChromeChange = useCallback((chrome: NoteEditorChrome | null) => {
    setNoteChrome(chrome);
  }, []);
  const editorGuard = useRef<Parameters<NavigationGuard>[0]>(null);
  const registerEditorGuard = useCallback<NavigationGuard>(
    (guard) => {
      editorGuard.current = guard;
      registerNavigationGuard(guard);
    },
    [registerNavigationGuard],
  );
  const toggleHome = () => {
    const proceed = () => setEditHome((value) => !value);
    if (!editorGuard.current?.(proceed)) proceed();
  };
  const coverInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const focus = useDrawerFocus(() => setDrawer(false), drawer);
  const projects = useQuery({
    retry: false,
    queryKey: thoughtKeys.projects(projectId ? "" : query, trash),
    queryFn: ({ signal }) =>
      listKnowledge(projectId ? "" : query, trash, signal),
  });
  const directory = useQuery({
    retry: false,
    queryKey: thoughtKeys.directory(projectId || ""),
    queryFn: ({ signal }) => getDirectory(projectId!, signal),
    enabled: !!projectId,
  });
  const project = directory.data?.knowledge_base;
  const currentId = noteId || project?.home_note_id;
  const note = useQuery({
    retry: false,
    queryKey: thoughtKeys.note(currentId || ""),
    queryFn: ({ signal }) => getNote(currentId!, signal),
    enabled: !!currentId,
  });
  const hasHomeContent = (
    note.data?.document as JSONContent | undefined
  )?.content?.some(
    (block) => block.type !== "paragraph" || block.content?.length,
  );
  const filtered = useNoteResults(projectId, query, view, browsing);
  useEffect(() => {
    setQuery("");
    setView("all");
    setBrowsing(false);
    setDrawer(false);
    setEditHome(false);
    setTrash(false);
  }, [projectId, noteId]);
  useEffect(() => {
    if (page === "thought-workshop-legacy" && note.data)
      onNavigate(
        note.data.knowledge_base_id,
        note.data.is_home ? undefined : note.data.id,
        true,
      );
  }, [page, note.data, onNavigate]);
  const refresh = () => client.invalidateQueries({ queryKey: thoughtKeys.all });
  const run = (work: () => Promise<unknown>) => {
    pendingOperations.current += 1;
    setBusy(true);
    const next = operationQueue.current.then(async () => {
      setNotice("");
      try {
        await work();
        await refresh();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "操作失败，请重试");
        await refresh();
      } finally {
        pendingOperations.current -= 1;
        setBusy(pendingOperations.current > 0);
      }
    });
    operationQueue.current = next;
    return next;
  };
  const guarded = (proceed: () => void) => {
    if (!editorGuard.current?.(proceed)) proceed();
  };
  const selectView = (next: string) =>
    guarded(() => {
      setView(next);
      setQuery("");
      setBrowsing(true);
      setDrawer(false);
    });
  const search = (value: string) =>
    guarded(() => {
      setQuery(value);
      setBrowsing(true);
    });
  const open = (id?: string) =>
    guarded(() => {
      setBrowsing(false);
      setQuery("");
      setDrawer(false);
      onNavigate(projectId, id === project?.home_note_id ? undefined : id);
    });
  const save = (saved: Note) => {
    client.setQueryData(thoughtKeys.note(saved.id), saved);
    void client.invalidateQueries({ queryKey: thoughtKeys.history(saved.id) });
    void client.invalidateQueries({ queryKey: thoughtKeys.projectLists() });
    void client.invalidateQueries({
      queryKey: thoughtKeys.directory(saved.knowledge_base_id),
    });
  };
  const create = (parent: string | null = null) =>
    run(async () => {
      const n = await createDocument(project!, parent);
      open(n.id);
    });
  const backup = (id?: string) =>
    run(async () => download(await downloadBackup(id), "思绪工坊备份.zip"));
  const metadata = (p: KnowledgeBase, field: "title" | "description") =>
    setInput({
      title: field === "title" ? "重命名知识库" : "修改简介",
      initial: p[field] || "",
      apply: (value) => updateKnowledge(p, { [field]: value }),
    });
  const projectAction = (value: string, p: KnowledgeBase) => {
    if (value === "rename") metadata(p, "title");
    if (value === "description") metadata(p, "description");
    if (value === "cover") {
      setCoverProject(p);
      coverInput.current?.click();
    }
    if (value === "clear-cover")
      void run(() => updateKnowledge(p, { cover_asset_id: null }));
    if (value === "export") void backup(p.id);
    if (value === "trash")
      setConfirm({
        title: "移入知识库回收站？",
        description:
          "知识库及其内容将整体隐藏。恢复后保留原目录和文档回收站状态。",
        apply: async () => {
          await trashKnowledge(p);
          if (projectId) {
            registerNavigationGuard(null);
            editorGuard.current = null;
            onNavigate();
          }
        },
      });
  };
  const treeAction = (value: string, item: NoteSummary) => {
    if (value === "new-document") void create(item.id);
    if (value === "move") {
      setMoving(item);
      setMoveParent("");
    }
    if (value === "delete") {
      const hasChildren = (directory.data?.documents || []).some(
        (doc) => doc.parent_id === item.id,
      );
      if (hasChildren) {
        setDeleteTarget(item);
        return;
      }
      setConfirm({
        title: "文档移入回收站？",
        description: "可在当前知识库的文档回收站恢复。",
        apply: async () => {
          await deleteNote(item);
          if (noteId === item.id) {
            registerNavigationGuard(null);
            editorGuard.current = null;
            open();
          }
        },
      });
    }
  };
  const removeDocument = async (item: NoteSummary, cascade: boolean) => {
    await deleteNote(item, false, cascade);
    const byId = new Map(
      (directory.data?.documents || []).map((doc) => [doc.id, doc]),
    );
    let current = noteId ? byId.get(noteId) : undefined;
    let shouldLeave = noteId === item.id;
    while (cascade && current) {
      if (current.id === item.id) {
        shouldLeave = true;
        break;
      }
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    if (shouldLeave) {
      registerNavigationGuard(null);
      editorGuard.current = null;
      open();
    }
  };
  const projectOptions = [
    { value: "", label: "更多", disabled: true },
    { value: "rename", label: "重命名" },
    { value: "description", label: "修改简介" },
    { value: "cover", label: "更换封面" },
    { value: "clear-cover", label: "恢复默认封面" },
    { value: "export", label: "导出知识库" },
    { value: "trash", label: "移入回收站" },
  ];
  const noteMode = (!!noteId || editHome) && !browsing;
  const noteMoreAction = (value: string) => {
    if (value === "import") importInput.current?.click();
    if (value === "save") void noteChrome?.save().catch(() => {});
    if (value === "history") noteChrome?.openHistory();
    if (value === "export-html") noteChrome?.exportNote("html");
    if (value === "export-markdown") noteChrome?.exportNote("markdown");
    if (project && (value === "rename" || value === "description"))
      projectAction(value, project);
  };
  const errors =
    (notice !== "导入完成" ? notice : "") ||
    directory.error?.message ||
    note.error?.message ||
    projects.error?.message ||
    filtered.error?.message;
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("future-props:amadeus-context", {
        detail: {
          application: "思绪工坊",
          projectId,
          title: project?.title || "思绪工坊",
          selection: currentId
            ? {
                id: currentId,
                name: note.data?.title || "文档",
                value: note.data?.title || "",
              }
            : undefined,
          unsaved: !!noteChrome && noteChrome.state !== "saved",
        },
      }),
    );
  }, [projectId, project?.title, currentId, note.data?.title, noteChrome]);
  return (
    <div
      className={`thought-shell knowledge-shell ${projectId ? "inside-knowledge" : ""}`}
    >
      {drawer && (
        <button
          className="knowledge-backdrop"
          aria-label="关闭目录遮罩"
          onClick={() => setDrawer(false)}
        />
      )}
      <KnowledgeSidebar
        sidebarRef={focus}
        drawer={drawer}
        close={() => setDrawer(false)}
        onBack={onBack}
        onNavigate={onNavigate}
        inside={!!projectId}
        query={query}
        search={search}
        view={view}
        browsing={browsing}
        noteId={noteId}
        home={() => open()}
        selectView={selectView}
        trash={trash}
        selectTrash={(value) => {
          setTrash(value);
          setDrawer(false);
        }}
      >
        <div className="knowledge-directory-label">
          <span>目录</span>
          <button
            type="button"
            className="knowledge-directory-add"
            aria-label="新建文档"
            onClick={() => void create()}
          >
            +
          </button>
        </div>
        {directory.data && (
          <KnowledgeTree
            directory={directory.data}
            activeId={browsing ? undefined : currentId}
            open={open}
            action={treeAction}
            move={(body) => void run(() => moveEntry(project!, body))}
          />
        )}
      </KnowledgeSidebar>
      <main className="knowledge-main">
        <KnowledgeTopbar
          noteMode={noteMode}
          busy={busy}
          projectTitle={project?.title}
          libraryTitle={
            !projectId && page !== "thought-workshop-legacy"
              ? trash
                ? "知识库回收站"
                : "所有知识库"
              : undefined
          }
          libraryDescription={
            !projectId && page !== "thought-workshop-legacy"
              ? trash
                ? "恢复或彻底清理已删除的知识库。"
                : "为想法建立一个空间，让知识有序生长。"
              : undefined
          }
          currentLabel={noteId ? note.data?.title || "文档" : "首页"}
          currentId={currentId}
          documents={directory.data?.documents || []}
          noteChrome={noteChrome}
          onOpenProject={() => open()}
          onOpenDocument={open}
          onOpenDirectory={() => setDrawer(true)}
          onImport={() => importInput.current?.click()}
          onCreateDocument={() => void create()}
          onBackup={() => void backup()}
          onCreateKnowledge={() =>
            setInput({
              title: "创建知识库",
              apply: async (title) => {
                const created = await createKnowledge(title);
                onNavigate(created.id);
              },
            })
          }
          onNoteAction={noteMoreAction}
          onProjectAction={(value) =>
            project ? projectAction(value, project) : undefined
          }
        />
        {errors && (
          <div role="alert" className="thought-error">
            {errors}
            <button className="btn" onClick={() => void refresh()}>
              重试
            </button>
          </div>
        )}
        {busy && (
          <p role="status" className="knowledge-notice">
            正在处理…
          </p>
        )}
        {!projectId && page !== "thought-workshop-legacy" ? (
          <section className="knowledge-library">
            <div className="knowledge-library-heading">
              <label className="knowledge-search">
                <Search size={17} />
                <input
                  aria-label="搜索知识库"
                  placeholder="搜索知识库…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            {!trash && (
              <OfficialLibraryCards query={query} onOpen={onOpenOfficial} />
            )}
            <h2>{trash ? "已删除的知识库" : "我的知识库"}</h2>
            <div className="knowledge-cards">
              {projects.data?.map((p) => (
                <ProjectLibraryCard
                  key={p.id}
                  project={p}
                  cover="canvas"
                  coverTitle={p.title}
                  coverDescription=""
                  coverContent={<KnowledgeCover assetId={p.cover_asset_id} />}
                  metadata={<span>{p.document_count} 篇文档</span>}
                  description={p.description || "一个属于你的知识空间"}
                  onOpen={() => !trash && onNavigate(p.id)}
                >
                  {trash ? (
                    <button
                      className="btn"
                      onClick={() => void run(() => restoreKnowledge(p))}
                    >
                      恢复知识库
                    </button>
                  ) : (
                    <>
                      <button className="btn" onClick={() => onNavigate(p.id)}>
                        进入知识库
                      </button>
                      <CustomSelect
                        ariaLabel={`${p.title}操作`}
                        value=""
                        options={projectOptions}
                        onChange={(v) => projectAction(v, p)}
                      />
                    </>
                  )}
                </ProjectLibraryCard>
              ))}
            </div>
            {projects.isLoading && <p role="status">正在加载知识库…</p>}
            {projects.data?.length === 0 && (
              <div className="knowledge-empty">
                <BookOpen size={40} />
                <h2>{trash ? "回收站为空" : "创建你的第一个知识库"}</h2>
                <p>用文件夹组织文档，随时记录、整理和继续写作。</p>
              </div>
            )}
          </section>
        ) : browsing ? (
          <KnowledgeDocumentResults
            view={view}
            query={query}
            loading={filtered.isLoading}
            items={filtered.items}
            total={filtered.total}
            hasMore={filtered.hasNextPage}
            loadingMore={filtered.isFetchingNextPage}
            onLoadMore={() => void filtered.fetchNextPage()}
            onOpen={open}
            onRestore={(n) => void run(() => restoreNote(n))}
            onDeleteForever={(n) =>
              setConfirm({
                title: "永久删除文档？",
                description: "正文将永久删除。引用的文件仍由文件管理负责清理。",
                apply: async () => {
                  await deleteNote(n, true);
                  if (noteId === n.id) open();
                },
              })
            }
          />
        ) : (
          <>
            {project && !noteId && (
              <>
                <KnowledgeCover assetId={project.cover_asset_id} />
                <div className="knowledge-home-heading">
                  <span>知识库首页</span>
                  <h1>{project.title}</h1>
                  {project.description && <p>{project.description}</p>}
                  <button className="btn" onClick={toggleHome}>
                    {editHome ? "返回阅读" : "编辑首页"}
                  </button>
                </div>
              </>
            )}
            {note.isLoading && (
              <p role="status" className="knowledge-notice">
                正在加载文档…
              </p>
            )}
            {note.data &&
              (!projectId || note.data.knowledge_base_id === projectId) && (
                <Suspense fallback={<p>编辑器加载中…</p>}>
                  {note.data.deleted_at ? (
                    <div className="knowledge-empty">
                      <p>这篇文档在回收站中</p>
                      <button
                        className="btn"
                        onClick={() => void run(() => restoreNote(note.data!))}
                      >
                        恢复文档
                      </button>
                    </div>
                  ) : note.data.is_home && !editHome ? (
                    <div className="knowledge-home-reading">
                      <RichEditor
                        outlineTitle={project?.title || note.data.title}
                        key={note.data.id}
                        document={note.data.document}
                        readOnly
                        onChange={() => {}}
                        onReady={() => {}}
                      />
                      {!hasHomeContent && (
                        <p className="knowledge-home-empty">
                          这里是知识库首页。点击「编辑首页」，写下介绍、目标或常用资料。
                        </p>
                      )}
                    </div>
                  ) : (
                    <NoteEditorPane
                      key={note.data.id}
                      note={note.data}
                      onSaved={save}
                      onOpen={open}
                      onChromeChange={onNoteChromeChange}
                      registerNavigationGuard={registerEditorGuard}
                    />
                  )}
                </Suspense>
              )}
          </>
        )}
        <input
          ref={coverInput}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f && coverProject)
              void run(async () => {
                const uploaded = await uploadImage(f);
                await updateKnowledge(coverProject, {
                  cover_asset_id: uploaded.asset_id,
                });
              });
          }}
        />
        <input
          ref={importInput}
          hidden
          type="file"
          accept=".zip,.md,.markdown"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f)
              void run(async () => {
                const { importFile } = await import("./portability");
                const result = await importFile(f, project);
                setNotice(result.warnings?.join(" ") || "导入完成");
                if (result.open_note_id) {
                  const importedNote = await getNote(result.open_note_id);
                  onNavigate(importedNote.knowledge_base_id, importedNote.id);
                } else {
                  const active = await listKnowledge("", false);
                  const first = active.find((p) =>
                    result.knowledge_base_ids?.includes(p.id),
                  );
                  onNavigate(first?.id);
                }
              });
          }}
        />
        <p className="knowledge-import-hint">
          完整备份由服务器校验；Markdown 内容包上限 128 MiB。
        </p>
      </main>
      <TextInputDialog
        open={!!input}
        title={input?.title || ""}
        label="名称或内容"
        initialValue={input?.initial}
        onCancel={() => setInput(null)}
        onConfirm={(value) => {
          const pending = input;
          setInput(null);
          if (pending) void run(() => pending.apply(value));
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ""}
        description={confirm?.description || ""}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const pending = confirm;
          setConfirm(null);
          if (pending) void run(pending.apply);
        }}
      />
      <ConfirmDialog
        open={!!moving}
        title="移动到"
        description={
          <div>
            <p>选择目标父文档，文档仅在当前知识库内移动。</p>
            <CustomSelect
              ariaLabel="目标父文档"
              value={moveParent}
              options={[
                { value: "", label: "知识库根目录" },
                ...(directory.data?.documents || [])
                  .filter((doc) => {
                    if (!moving || doc.id === moving.id) return false;
                    const blocked = new Set<string>([moving.id]);
                    const walk = (id: string) => {
                      for (const child of directory.data?.documents || []) {
                        if (child.parent_id === id && !blocked.has(child.id)) {
                          blocked.add(child.id);
                          walk(child.id);
                        }
                      }
                    };
                    walk(moving.id);
                    return !blocked.has(doc.id);
                  })
                  .map((doc) => ({ value: doc.id, label: doc.title })),
              ]}
              onChange={setMoveParent}
            />
          </div>
        }
        confirmLabel="移动"
        onCancel={() => setMoving(null)}
        onConfirm={() => {
          const item = moving;
          setMoving(null);
          if (item)
            void run(() =>
              moveEntry(project!, {
                item_id: item.id,
                parent_id: moveParent || null,
              }),
            );
        }}
      />
      <DeleteDocumentDialog
        open={!!deleteTarget}
        title={deleteTarget?.title || ""}
        pending={busy}
        onCancel={() => setDeleteTarget(null)}
        onDeleteSelf={() => {
          const item = deleteTarget;
          setDeleteTarget(null);
          if (item) void run(() => removeDocument(item, false));
        }}
        onDeleteSubtree={() => {
          const item = deleteTarget;
          setDeleteTarget(null);
          if (item) void run(() => removeDocument(item, true));
        }}
      />
    </div>
  );
}
