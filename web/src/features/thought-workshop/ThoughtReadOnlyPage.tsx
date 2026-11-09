import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { LoadingState } from "@shared/ui/LoadingState";
import "./document-layout/reading.css";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { FileCode2 } from "lucide-react";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { getNote } from "./api";
import { getDirectory, listKnowledge } from "./knowledgeApi";
import { thoughtKeys } from "./queryKeys";
import { KnowledgeSidebar } from "./KnowledgeSidebar";
import { KnowledgeTree } from "./KnowledgeTree";
import { KnowledgeSections, type KnowledgeSection } from "./KnowledgeSections";
import { KnowledgeActionMenu } from "./KnowledgeActionMenu";
import { NoteReaderPane } from "./NoteReaderPane";
import { useDocumentChrome } from "./document-layout/useDocumentChrome";
import { DiscoveryPanel } from "./knowledge-tools/DiscoveryPanel";
import { DocumentRelations } from "./knowledge-tools/DocumentRelations";
import { useNoteResults } from "./useNoteResults";
import { KnowledgeDocumentResults } from "./KnowledgeDocumentResults";
import { exportLibraryHtml } from "./knowledge-tools/libraryExport";
import "./thought-workshop.css";
import "./knowledge.css";
import "./writing-layout.css";
import "./community/community.css";
const TableEditor = lazy(() =>
  import("./multitable/TableEditor").then((m) => ({ default: m.TableEditor })),
);
export function ThoughtReadOnlyPage({
  projectId,
  documentId,
  onOpen,
  onNavigateSection,
  onBack,
  utilityBar,
}: {
  projectId?: string;
  documentId?: string;
  onOpen: (projectId?: string, documentId?: string) => void;
  onOpenOfficial: (libraryId: string) => void;
  onNavigateSection?: (section: KnowledgeSection) => void;
  onBack?: () => void;
  utilityBar?: ReactNode;
}) {
  const documentUI = useDocumentChrome();
  const [discovery, setDiscovery] = useState(false),
    [query, setQuery] = useState(""),
    [drawer, setDrawer] = useState(false),
    [view, setView] = useState("all"),
    [browsing, setBrowsing] = useState(false),
    [error, setError] = useState("");
  const sidebar = useDrawerFocus(() => setDrawer(false), drawer);
  const projects = useQuery({
    queryKey: thoughtKeys.projects(),
    queryFn: ({ signal }) => listKnowledge("", false, signal),
  });
  const directory = useQuery({
    queryKey: thoughtKeys.directory(projectId ?? ""),
    queryFn: ({ signal }) => getDirectory(projectId!, signal),
    enabled: !!projectId,
  });
  const current = documentId ?? directory.data?.knowledge_base.home_note_id;
  const note = useQuery({
    queryKey: thoughtKeys.note(current ?? ""),
    queryFn: ({ signal }) => getNote(current!, signal),
    enabled: !!current,
  });
  const filtered = useNoteResults(projectId, query, view, browsing);
  const open = (id?: string) => {
    setDrawer(false);
    setBrowsing(false);
    setQuery("");
    onOpen(projectId, id);
  };
  return (
    <div className="thought-shell knowledge-shell">
      <KnowledgeSidebar
        showThemeToggle={!utilityBar}
        readOnly
        sidebarRef={sidebar}
        drawer={drawer}
        close={() => setDrawer(false)}
        onBack={onBack ?? (() => onNavigateSection?.("community"))}
        onNavigate={() => onOpen()}
        inside={!!projectId}
        query={query}
        search={(q) => {
          setQuery(q);
          setBrowsing(true);
        }}
        view={view}
        browsing={browsing}
        noteId={documentId}
        home={() => open()}
        selectView={(v) => {
          setView(v);
          setBrowsing(true);
        }}
        trash={false}
        selectTrash={() => {}}
        discover={() => setDiscovery(!discovery)}
        sections={
          onNavigateSection ? (
            <KnowledgeSections active="private" navigate={onNavigateSection} />
          ) : undefined
        }
      >
        <div className="knowledge-reading-directory">
          <KnowledgeTree
            directory={{
              documents: (directory.data?.documents ?? []).filter(
                (n) => !n.is_home,
              ),
            }}
            label="知识库目录"
            activeId={current}
            open={open}
          />
        </div>
      </KnowledgeSidebar>
      {drawer && (
        <button
          className="knowledge-backdrop"
          aria-label="关闭目录遮罩"
          onClick={() => setDrawer(false)}
        />
      )}
      <main className="knowledge-main">
        {utilityBar ? (
          <WorkshopAppChrome
            className="knowledge-library-toolbar"
            title="我的知识库"
            utilities={utilityBar}
            actions={
              <>
                <button
                  className="btn knowledge-mobile"
                  onClick={() => setDrawer(true)}
                >
                  目录
                </button>
                <span className="community-permission-badge">可读</span>
              </>
            }
          />
        ) : (
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
                  {directory.data?.knowledge_base.title ?? "我的知识库"}
                </button>
                {documentId && (
                  <>
                    <span>/</span>
                    <span>{note.data?.title}</span>
                  </>
                )}
              </nav>
            </div>
            <div className="knowledge-top-actions">
              <div
                className="knowledge-document-tools"
                ref={documentUI.toolsRef}
              />
              <span className="community-permission-badge">可读</span>
              {projectId && (
                <KnowledgeActionMenu
                  ariaLabel="知识库更多操作"
                  groups={[
                    [
                      {
                        value: "export",
                        label: "导出整库 HTML",
                        icon: FileCode2,
                      },
                    ],
                  ]}
                  onAction={() =>
                    void exportLibraryHtml(projectId).catch((e) =>
                      setError(e.message),
                    )
                  }
                />
              )}
            </div>
          </header>
        )}

        {(error || note.error || directory.error || projects.error) && (
          <p className="thought-error" role="alert">
            {error ||
              note.error?.message ||
              directory.error?.message ||
              projects.error?.message}
          </p>
        )}
        {discovery && (
          <DiscoveryPanel
            projects={projects.data ?? []}
            close={() => setDiscovery(false)}
            navigate={(href) => {
              history.pushState({}, "", href);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          />
        )}
        {!projectId ? (
          <section className="knowledge-library">
            {!utilityBar && <h1>我的知识库</h1>}
            <div className="community-books">
              {projects.data?.map((p) => (
                <article className="community-book" key={p.id}>
                  <div className="community-book-copy">
                    <h3>{p.title}</h3>
                    <p>{p.description}</p>
                    <button className="btn" onClick={() => onOpen(p.id)}>
                      进入知识库
                    </button>
                  </div>
                </article>
              ))}
            </div>
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
            onRestore={() => {}}
            onDeleteForever={() => {}}
          />
        ) : note.data ? (
          <>
            {note.data.kind === "multitable" ? (
              <Suspense
                fallback={
                  <LoadingState label="正在加载表格…" variant="region" />
                }
              >
                <TableEditor noteId={note.data.id} note={note.data} readOnly />
              </Suspense>
            ) : (
              <NoteReaderPane
                note={note.data}
                documentChrome={documentUI.chrome}
              />
            )}
            <DocumentRelations
              id={note.data.id}
              documents={directory.data?.documents ?? []}
              open={open}
            />
          </>
        ) : (
          <LoadingState
            label="正在加载文档…"
            variant="region"
            className="knowledge-notice"
          />
        )}
      </main>
    </div>
  );
}
