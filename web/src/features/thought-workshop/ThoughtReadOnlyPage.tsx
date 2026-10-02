import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { OfficialLibraryCards } from "./official/OfficialLibraryCards";
import { ReadOnlyCollection, ReadOnlyPage } from "@shared/ui/ReadOnlyPage";
import { getNote } from "./api";
import { getDirectory, listKnowledge } from "./knowledgeApi";
import { thoughtKeys } from "./queryKeys";
import { RichEditor } from "./RichEditor";
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
  const [query, setQuery] = useState("");
  const projects = useQuery({
    queryKey: thoughtKeys.projects(),
    queryFn: ({ signal }) => listKnowledge("", false, signal),
    enabled: !projectId,
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
      {documentId && note.data ? (
        <>
          <p>{note.data.tags.join(" · ")}</p>
          <RichEditor
            key={note.data.id}
            outlineTitle={note.data.title}
            document={note.data.document}
            readOnly
            onChange={() => {}}
            onReady={() => {}}
          />
        </>
      ) : projectId ? (
        <ReadOnlyCollection
          items={directory.data?.documents || []}
          onOpen={(id) => onOpen(projectId, id)}
        />
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
