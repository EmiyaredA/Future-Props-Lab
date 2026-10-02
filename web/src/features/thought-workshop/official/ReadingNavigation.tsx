import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import {
  findOfficialLibrary,
  officialReadingOrder,
  type OfficialKnowledgeBase,
  type OfficialDocumentSummary,
} from "./catalog";
import { officialGroupDescription } from "./reading";

type OpenArticle = (libraryId: string, documentId?: string) => void;

export function OfficialLibraryHome({
  library,
  onOpen,
}: {
  library: OfficialKnowledgeBase;
  onOpen: OpenArticle;
}) {
  const first = library.documents[0];
  const groups = [...new Set(library.documents.map((item) => item.group))];
  return (
    <section className="official-home">
      <span className="official-badge">
        官方 · 只读 · {library.documents.length} 篇文章
      </span>
      <h1>{library.title}</h1>
      <p className="official-home-lead">{library.description}</p>
      {first && (
        <button
          className="official-start"
          onClick={() => onOpen(library.id, first.id)}
        >
          <span>
            <small>从这里开始</small>
            <strong>{first.title}</strong>
            <span>{first.summary}</span>
          </span>
          <ArrowRight size={22} aria-hidden />
        </button>
      )}
      {groups.map((group) => (
        <section className="official-home-group" key={group}>
          <h2>{group}</h2>
          <p>{officialGroupDescription(group)}</p>
          <div className="official-article-cards">
            {library.documents
              .filter((item) => item.group === group)
              .map((item) => (
                <button
                  className="official-result"
                  key={item.id}
                  onClick={() => onOpen(library.id, item.id)}
                >
                  <BookOpen size={18} aria-hidden />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.summary}</small>
                  </span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </section>
  );
}

export function ReadingNavigation({
  library,
  current,
  onOpen,
}: {
  library: OfficialKnowledgeBase;
  current: OfficialDocumentSummary;
  onOpen: OpenArticle;
}) {
  const documents = officialReadingOrder(library);
  const index = documents.findIndex((item) => item.id === current.id);
  const previous = documents[index - 1];
  const next = documents[index + 1];
  return (
    <footer className="official-reading-footer">
      <nav className="official-adjacent" aria-label="前后篇导航">
        {previous && (
          <button onClick={() => onOpen(library.id, previous.id)}>
            <ArrowLeft size={18} aria-hidden />
            <span>
              <small>上一篇</small>
              <strong>{previous.title}</strong>
            </span>
          </button>
        )}
        {next && (
          <button
            className="official-next"
            onClick={() => onOpen(library.id, next.id)}
          >
            <span>
              <small>下一篇</small>
              <strong>{next.title}</strong>
            </span>
            <ArrowRight size={18} aria-hidden />
          </button>
        )}
      </nav>
      <nav className="official-related" aria-label="相关阅读">
        <h2>继续阅读</h2>
        {current.related.map((ref) => {
          const relatedLibrary = findOfficialLibrary(ref.libraryId);
          const article = relatedLibrary?.documents.find(
            (item) => item.id === ref.documentId,
          );
          return (
            article && (
              <button
                key={`${ref.libraryId}/${ref.documentId}`}
                onClick={() => onOpen(ref.libraryId, ref.documentId)}
              >
                <strong>{article.title}</strong>
                <span>{article.summary}</span>
                <small>{relatedLibrary?.title}</small>
              </button>
            )
          );
        })}
      </nav>
    </footer>
  );
}
