import { LoadingState } from "@shared/ui/LoadingState";
import { lazy, Suspense } from "react";
import type { Note } from "./api";
import type { DocumentChrome } from "./document-layout/useDocumentChrome";
const RichEditor = lazy(() =>
  import("./RichEditor").then((m) => ({ default: m.RichEditor })),
);
export function NoteReaderPane({
  note,
  readingId,
  onNavigateHref,
  documentChrome,
}: {
  note: Note;
  readingId?: string;
  onNavigateHref?: (href: string) => void;
  documentChrome?: DocumentChrome;
}) {
  return (
    <div className="thought-edit-workspace">
      <section className="thought-document">
        <Suspense
          fallback={<LoadingState label="正在加载正文…" variant="region" />}
        >
          <RichEditor
            documentChrome={documentChrome}
            libraryId={note.knowledge_base_id}
            onNavigateHref={onNavigateHref}
            document={note.document}
            readOnly
            readingId={readingId ?? note.id}
            readingRevision={note.revision}
            outlineTitle={note.title}
            onChange={() => {}}
            onReady={() => {}}
            beforeContent={
              <div className="thought-note-heading">
                <h1 className="community-note-title" data-amadeus-id={note.id}>
                  {note.title}
                </h1>
                {!!note.tags.length && (
                  <p className="community-meta">{note.tags.join(" · ")}</p>
                )}
              </div>
            }
          />
        </Suspense>
      </section>
    </div>
  );
}
