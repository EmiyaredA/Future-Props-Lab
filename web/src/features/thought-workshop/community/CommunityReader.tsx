import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileCode2,
  FileText,
  Save,
  Shield,
  Sparkles,
} from "lucide-react";
import { useAccountId } from "@platform/auth/WorkspacePermissions";
import { ApiError } from "@platform/api/client";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { DocumentAccessProvider, type DocumentAccess } from "../DocumentAccess";
import { KnowledgeTree } from "../KnowledgeTree";
import { KnowledgeSidebar } from "../KnowledgeSidebar";
import type { KnowledgeSection } from "../KnowledgeSections";
import { KnowledgeActionMenu } from "../KnowledgeActionMenu";
import { DocumentRelations } from "../knowledge-tools/DocumentRelations";
import { TableEditor } from "../multitable/TableEditor";
import { NoteReaderPane } from "../NoteReaderPane";
import { useDocumentChrome } from "../document-layout/useDocumentChrome";
import type { NavigationGuard } from "../NoteEditorPane";
import type { NoteEditorChrome } from "../noteEditorChrome";
import { thoughtKeys } from "../queryKeys";
import {
  communityBacklinks,
  communityAssetUrl,
  communitySnapshot,
  getCommunityDirectory,
  resolveCommunityReferences,
  getCommunityNote,
  saveCommunityNote,
  uploadCommunityFile,
} from "./api";
import { PermissionsDialog } from "./PermissionsDialog";
import "../thought-workshop.css";
import "../writing-layout.css";
import "../knowledge.css";
import "../document-layout/reading.css";
import "./community.css";
const NoteEditorPane = lazy(() =>
  import("../NoteEditorPane").then((m) => ({ default: m.NoteEditorPane })),
);
export function CommunityReader({
  publication,
  noteId,
  navigate,
  onOpen,
  registerNavigationGuard,
}: {
  publication: string;
  noteId?: string;
  navigate: (s: KnowledgeSection) => void;
  onOpen: (note?: string) => void;
  registerNavigationGuard: NavigationGuard;
}) {
  const documentUI = useDocumentChrome();
  const user = useAccountId() ?? "",
    client = useQueryClient();
  const [query, setQuery] = useState(""),
    [drawer, setDrawer] = useState(false),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const [chrome, setChrome] = useState<NoteEditorChrome | null>(null),
    [permissionIds, setPermissionIds] = useState<string[] | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const guard = useRef<Parameters<NavigationGuard>[0]>(null);
  const sidebar = useDrawerFocus(() => setDrawer(false), drawer);
  const directory = useQuery({
    queryKey: thoughtKeys.communityDirectory(user, publication),
    queryFn: ({ signal }) => getCommunityDirectory(publication, signal),
    retry: false,
  });
  const home = directory.data?.documents.find((n) => n.is_home)?.id;
  const current = noteId ?? home;
  const article = useQuery({
    queryKey: thoughtKeys.communityNote(user, publication, current ?? ""),
    queryFn: ({ signal }) => getCommunityNote(publication, current!, signal),
    enabled: !!current,
    retry: false,
  });
  const referencePublications = useMemo(
    () => ({
      namespace: `community/${user}/${publication}`,
      targets: new Map<string, string>(),
    }),
    [publication, user],
  );
  const adapter = useMemo<DocumentAccess>(
    () => ({
      namespace: referencePublications.namespace,
      community: true,
      publicationId: publication,
      currentNoteId: current,
      directory: async (_library, signal) =>
        (await getCommunityDirectory(publication, signal)).documents,
      canViewHistory: false,
      backlinks: (id, offset) => communityBacklinks(publication, id, offset),
      assetUrl: (id) => communityAssetUrl(publication, id, current),
      uploadImage: (file) => uploadCommunityFile(publication, current!, file),
      uploadAttachment: (file) =>
        uploadCommunityFile(publication, current!, file),
      save: async (id, body, revision) => {
        try {
          return (await saveCommunityNote(publication, id, body, revision))
            .note;
        } catch (e) {
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
            void client.invalidateQueries({
              queryKey: thoughtKeys.community(user),
            });
          }
          throw e;
        }
      },
      resolveReferences: async (ids, signal) => {
        const rows = await resolveCommunityReferences(publication, ids, signal);
        for (const row of rows) {
          if (row.available && row.publication_id)
            referencePublications.targets.set(row.id, row.publication_id);
          else referencePublications.targets.delete(row.id);
        }
        return rows;
      },
      searchNotes: async (criteria, offset = 0, signal) => {
        const d = await getCommunityDirectory(publication, signal);
        const rows = d.documents.filter((n) =>
          n.title
            .toLocaleLowerCase()
            .includes((criteria.query ?? "").toLocaleLowerCase()),
        );
        return {
          items: rows.slice(offset, offset + 40).map((n) => ({
            ...n,
            knowledge_base_title: d.publication.title,
            path: [],
            snippet: n.excerpt,
          })),
          total: rows.length,
        };
      },
      referenceHref: (id) =>
        `/apps/thought-workshop/community/${encodeURIComponent(referencePublications.targets.get(id) ?? publication)}/documents/${encodeURIComponent(id)}`,
    }),
    [publication, current, user, client, referencePublications],
  );
  const guarded = (work: () => void) => {
    if (!guard.current?.(work)) work();
  };
  const open = (id?: string) =>
    guarded(() => {
      setEditing(false);
      setDrawer(false);
      setQuery("");
      onOpen(id);
    });
  const role = article.isError ? undefined : article.data?.role;
  const refresh = () =>
    client.invalidateQueries({ queryKey: thoughtKeys.community(user) });
  const navigateDocumentHref = (href: string) => {
    const match = /\/community\/([^/]+)\/documents\/([^/]+)$/.exec(href);
    if (match && decodeURIComponent(match[1]) === publication)
      open(decodeURIComponent(match[2]));
    else
      guarded(() => {
        window.history.pushState({}, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
  };
  const exportLibrary = async () => {
    try {
      if (editing && chrome) await chrome.save();
      const { exportLibraryHtml } =
        await import("../knowledge-tools/libraryExport");
      await exportLibraryHtml(publication, {
        snapshot: () => communitySnapshot(publication),
        navigation: adapter,
        assetUrl: (id) => communityAssetUrl(publication, id),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    }
  };
  const groups = [
    ...(directory.data && !directory.isError
      ? [
          [
            {
              value: "library-export",
              label: "导出可读文章 HTML",
              icon: FileCode2,
            },
          ],
        ]
      : []),
    ...(editing && chrome
      ? [
          [
            ...(article.data?.can_edit
              ? [{ value: "save", label: "保存", icon: Save }]
              : []),
            {
              value: "markdown",
              label: "导出当前文章 Markdown",
              icon: FileText,
            },
          ],
        ]
      : []),
    ...(article.data?.can_manage
      ? [[{ value: "permissions", label: "文章访问权限", icon: Shield }]]
      : []),
  ];
  const docs =
    directory.data?.documents.filter(
      (n) =>
        !n.is_home &&
        `${n.title} ${n.excerpt}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    ) ?? [];
  return (
    <DocumentAccessProvider value={adapter}>
      <div className="thought-shell knowledge-shell community-shell">
        {drawer && (
          <button
            className="knowledge-backdrop"
            aria-label="关闭目录遮罩"
            onClick={() => setDrawer(false)}
          />
        )}
        <KnowledgeSidebar
          sidebarRef={sidebar}
          drawer={drawer}
          close={() => setDrawer(false)}
          onBack={() => navigate("community")}
          onNavigate={() => navigate("community")}
          inside
          query=""
          search={() => {}}
          view="all"
          browsing={false}
          home={() => open()}
          selectView={() => {}}
          trash={false}
          selectTrash={() => {}}
          content={
            <>
              <button
                type="button"
                className="workshop-back"
                aria-label="返回知识社区"
                onClick={() => guarded(() => navigate("community"))}
              >
                <span className="workshop-back-icon">
                  <ArrowLeft aria-hidden />
                </span>
                <span className="workshop-back-copy">
                  <strong>知识社区</strong>
                  <small>返回知识社区</small>
                </span>
              </button>
              <label className="knowledge-search">
                <input
                  aria-label="搜索当前知识库"
                  placeholder="搜索可访问文章…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="knowledge-directory-scroll knowledge-reading-directory">
                <button className="knowledge-home-link" onClick={() => open()}>
                  知识库首页
                </button>
                <KnowledgeTree
                  directory={{ documents: docs }}
                  label="社区文档目录"
                  activeId={current}
                  open={open}
                  rowActions={(n) =>
                    n.can_manage ? (
                      <input
                        type="checkbox"
                        aria-label={`批量设置 ${n.title}`}
                        checked={selected.includes(n.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, n.id]
                              : selected.filter((id) => id !== n.id),
                          )
                        }
                      />
                    ) : null
                  }
                />
                {selected.length > 0 && (
                  <button
                    className="btn"
                    onClick={() => setPermissionIds(selected)}
                  >
                    批量设置权限
                  </button>
                )}
              </div>
            </>
          }
        >
          {null}
        </KnowledgeSidebar>
        <main className="knowledge-main">
          <header className="knowledge-topbar is-note">
            <button
              className="btn knowledge-mobile"
              onClick={() => setDrawer(true)}
            >
              目录
            </button>
            <div className="knowledge-topbar-start">
              <nav className="knowledge-breadcrumb" aria-label="文档路径">
                <button onClick={() => open()}>
                  {directory.data?.publication.title ?? "社区知识库"}
                </button>
                {noteId && (
                  <>
                    <span>/</span>
                    <span aria-current="page">
                      {article.data?.note.title ?? "文章"}
                    </span>
                  </>
                )}
              </nav>
              {editing && chrome && (
                <span
                  role="status"
                  className={`thought-save-state is-${chrome.state}`}
                >
                  {
                    {
                      saved: "已保存",
                      dirty: "待保存",
                      saving: "保存中…",
                      error: "保存失败",
                      conflict: "保存冲突",
                    }[chrome.state]
                  }
                </span>
              )}
            </div>
            <div className="knowledge-top-actions">
              <div
                className="knowledge-document-tools"
                ref={documentUI.toolsRef}
              />
              {window.futurePropsDesktop?.openAmadeus && (
                <button
                  className="btn"
                  aria-label="打开 Amadeus"
                  onClick={() =>
                    void window.futurePropsDesktop?.openAmadeus?.()
                  }
                >
                  <Sparkles size={16} aria-hidden /> Amadeus
                </button>
              )}
              {directory.data?.publication.is_official && (
                <span className="official-badge">官方</span>
              )}
              <span className="community-permission-badge">
                {role === "manage"
                  ? "可管理"
                  : role === "edit"
                    ? "可编辑"
                    : role === "read"
                      ? "可读"
                      : "访问不可用"}
              </span>
              {article.data && (editing || article.data?.can_edit) && (
                <button
                  className="btn"
                  onClick={() => guarded(() => setEditing(!editing))}
                >
                  {editing ? "返回阅读" : "编辑文档"}
                </button>
              )}
              <KnowledgeActionMenu
                ariaLabel="社区文档更多操作"
                groups={groups}
                onAction={(value) => {
                  if (value === "library-export") void exportLibrary();
                  if (value === "save") void chrome?.save().catch(() => {});
                  if (value === "markdown") chrome?.exportNote("markdown");
                  if (value === "permissions" && current)
                    setPermissionIds([current]);
                }}
              />
            </div>
          </header>
          {(error || directory.error || article.error) && (
            <div role="alert" className="thought-error">
              {error || directory.error?.message || article.error?.message}
              <button
                className="btn"
                onClick={() => {
                  void directory.refetch();
                  void article.refetch();
                }}
              >
                重试
              </button>
            </div>
          )}
          {directory.isPending || (article.isPending && current) ? (
            <p role="status" className="knowledge-notice">
              正在加载文档…
            </p>
          ) : null}
          {article.data && (!article.isError || editing) ? (
            article.data.note.kind === "multitable" ? (
              <TableEditor
                key={`${publication}/${current}`}
                noteId={current!}
                note={article.data.note}
                scope={{ publication }}
                readOnly={!article.data?.can_edit}
                guard={registerNavigationGuard}
              />
            ) : editing ? (
              <Suspense fallback={<p role="status">编辑器加载中…</p>}>
                <NoteEditorPane
                  documentChrome={documentUI.chrome}
                  key={`${user}:${publication}:${current}`}
                  note={article.data.note}
                  onSaved={(n) => {
                    client.setQueryData(
                      thoughtKeys.communityNote(user, publication, n.id),
                      { ...article.data, note: n },
                    );
                    void refresh();
                  }}
                  onOpen={open}
                  onNavigateHref={navigateDocumentHref}
                  onChromeChange={setChrome}
                  registerNavigationGuard={(g) => {
                    guard.current = g;
                    registerNavigationGuard(g);
                  }}
                />
              </Suspense>
            ) : (
              <NoteReaderPane
                documentChrome={documentUI.chrome}
                key={`${publication}:${current}`}
                note={article.data.note}
                readingId={`${adapter.namespace}/${current}`}
                onNavigateHref={navigateDocumentHref}
              />
            )
          ) : !current && directory.data ? (
            <section className="knowledge-reading-home">
              <span className="community-meta">社区知识库</span>
              <h1>{directory.data.publication.title}</h1>
              <p>{directory.data.publication.description}</p>
              <div className="knowledge-reading-list">
                {docs.map((n) => (
                  <button className="btn" key={n.id} onClick={() => open(n.id)}>
                    {n.title}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {article.data && !article.isError && directory.data && (
            <DocumentRelations
              id={article.data.note.id}
              documents={directory.data.documents}
              open={open}
            />
          )}
        </main>
        {permissionIds && (
          <PermissionsDialog
            publication={publication}
            notes={permissionIds}
            close={() => setPermissionIds(null)}
            saved={() => {
              setPermissionIds(null);
              setSelected([]);
              void refresh();
            }}
          />
        )}
      </div>
    </DocumentAccessProvider>
  );
}
