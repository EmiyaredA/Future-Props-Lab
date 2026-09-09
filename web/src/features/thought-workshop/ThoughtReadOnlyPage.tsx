import { useQuery } from "@tanstack/react-query";
import { ReadOnlyCollection, ReadOnlyPage } from "@shared/ui/ReadOnlyPage";
import { getNote } from "./api";
import { getDirectory, listKnowledge } from "./knowledgeApi";
import { thoughtKeys } from "./queryKeys";
import { RichEditor } from "./RichEditor";
export function ThoughtReadOnlyPage({
  projectId,
  documentId,
  onOpen,
}: {
  projectId?: string;
  documentId?: string;
  onOpen: (projectId?: string, documentId?: string) => void;
}) {
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
  return (
    <ReadOnlyPage
      title={
        note.data?.title || directory.data?.knowledge_base.title || "思绪工坊"
      }
      error={projects.error || directory.error || note.error}
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
        <ReadOnlyCollection
          items={projects.data || []}
          onOpen={(id) => onOpen(id)}
        />
      )}
    </ReadOnlyPage>
  );
}
