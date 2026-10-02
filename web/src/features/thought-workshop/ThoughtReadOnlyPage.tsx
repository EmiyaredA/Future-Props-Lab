import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { OfficialLibraryCards } from "./official/OfficialLibraryCards";
import { ReadOnlyPage } from "@shared/ui/ReadOnlyPage";
import { getNote } from "./api";
import { getDirectory, listKnowledge } from "./knowledgeApi";
import { thoughtKeys } from "./queryKeys";
import { DiscoveryPanel } from "./knowledge-tools/DiscoveryPanel";
import { DocumentRelations } from "./knowledge-tools/DocumentRelations";
import { useNoteResults } from "./useNoteResults";
import { KnowledgeDocumentResults } from "./KnowledgeDocumentResults";
import { RichEditor } from "./RichEditor";
import { exportLibraryHtml } from "./knowledge-tools/libraryExport";
export function ThoughtReadOnlyPage({
  projectId,
  documentId,
  onOpen,
  onOpenOfficial,
}: {
  projectId?: string;
  documentId?: string;
  onOpen: (projectId?: string, documentId?: string) => void;
  onOpenOfficial: (libraryId: string) => void;
}) {
  const [discovery, setDiscovery] = useState(false);
  const [query, setQuery] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const projects = useQuery({
    queryKey: thoughtKeys.projects(),
    queryFn: ({ signal }) => listKnowledge("", false, signal),
  });
  const directory = useQuery({
    queryKey: thoughtKeys.directory(projectId || ""),
    queryFn: ({ signal }) => getDirectory(projectId!, signal),
    enabled: !!projectId,
  });
  const note = useQuery({
    queryKey: thoughtKeys.note(documentId || ""),
    queryFn: ({ signal }) => getNote(documentId!, signal),
    enabled: !!documentId,
  });
  const homeId = directory.data?.knowledge_base.home_note_id;
  const home = useQuery({
    queryKey: thoughtKeys.note(homeId ?? ""),
    queryFn: ({ signal }) => getNote(homeId!, signal),
    enabled: !!homeId && !documentId,
  });
  const results = useNoteResults(projectId, query, "all", !documentId);
  const filteredProjects = projects.data?.filter((item) =>
    item.title
      .toLocaleLowerCase("zh-CN")
      .includes(query.trim().toLocaleLowerCase("zh-CN")),
  );
  return (
    <ReadOnlyPage
      title={
        note.data?.title || directory.data?.knowledge_base.title || "所有知识库"
      }
      error={projectId ? directory.error || note.error : undefined}
      loading={
        documentId
          ? note.isPending
          : projectId
            ? directory.isPending
            : projects.isPending
      }
      onBack={
        projectId ? () => onOpen(documentId ? projectId : undefined) : undefined
      }
    >
      <button className="btn" onClick={() => setDiscovery(!discovery)}>
        全局搜索与最近访问
      </button>
      {projectId && (
        <button
          className="btn"
          disabled={exporting}
          onClick={() => {
            setExporting(true);
            setExportError("");
            void exportLibraryHtml(projectId)
              .catch((error) => setExportError(error.message))
              .finally(() => setExporting(false));
          }}
        >
          {exporting ? "正在导出…" : "整库 HTML 导出"}
        </button>
      )}
      {exportError && <p role="alert">{exportError}</p>}
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
      {documentId && note.data ? (
        <>
          <p>{note.data.tags.join(" · ")}</p>
          <RichEditor
            key={note.data.id}
            readingId={note.data.id}
            readingRevision={note.data.revision}
            outlineTitle={note.data.title}
            document={note.data.document}
            readOnly
            onChange={() => {}}
            onReady={() => {}}
          />
          <DocumentRelations
            id={note.data.id}
            isHome={note.data.is_home}
            documents={directory.data?.documents ?? []}
            open={(id) => onOpen(projectId, id)}
          />
        </>
      ) : projectId ? (
        <>
          {home.data && !query && (
            <>
              <RichEditor
                key={home.data.id}
                document={home.data.document}
                outlineTitle={directory.data?.knowledge_base.title}
                readOnly
                onChange={() => {}}
                onReady={() => {}}
                readingId={home.data.id}
                readingRevision={home.data.revision}
              />
              <DocumentRelations
                id={home.data.id}
                isHome
                documents={directory.data?.documents ?? []}
                open={(id) => onOpen(projectId, id)}
              />
            </>
          )}
          <input
            className="readonly-search"
            aria-label="搜索知识库文档"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、正文与标签…"
          />
          <KnowledgeDocumentResults
            view="all"
            query={query}
            loading={results.isPending}
            items={results.items}
            total={results.total}
            hasMore={results.hasNextPage}
            loadingMore={results.isFetchingNextPage}
            onLoadMore={() => void results.fetchNextPage()}
            onOpen={(id) => onOpen(projectId, id)}
            onRestore={() => {}}
            onDeleteForever={() => {}}
          />
          {results.error && (
            <p role="alert">
              {results.error.message}
              <button className="btn" onClick={() => void results.refetch()}>
                重试
              </button>
            </p>
          )}
        </>
      ) : (
        <>
          <input
            className="readonly-search"
            aria-label="搜索知识库"
            placeholder="搜索知识库…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <OfficialLibraryCards query={query} onOpen={onOpenOfficial} />
          <h2>我的知识库</h2>
          {projects.error && (
            <p role="alert">
              个人知识库暂时无法读取。
              <button className="btn" onClick={() => void projects.refetch()}>
                重试
              </button>
            </p>
          )}
          <div className="readonly-collection">
            {filteredProjects?.map((item) => (
              <button
                className="readonly-card"
                key={item.id}
                onClick={() => onOpen(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
                <small>查看内容 →</small>
              </button>
            ))}
          </div>
          {projects.isSuccess && !filteredProjects?.length && (
            <p>没有匹配的个人知识库。</p>
          )}
        </>
      )}
    </ReadOnlyPage>
  );
}
