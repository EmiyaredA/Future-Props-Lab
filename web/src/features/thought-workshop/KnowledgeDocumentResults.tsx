import { FileText, Home, Pin, Star } from "lucide-react";
import { relativeTime } from "@shared/lib/date";
import type { NoteSummary } from "./api";
import { documentViews } from "./knowledgeViews";
import "./knowledge-results.css";

export function KnowledgeDocumentResults({
  view,
  query,
  loading,
  items,
  total,
  onOpen,
  onRestore,
  onDeleteForever,
}: {
  view: string;
  query: string;
  loading: boolean;
  items: NoteSummary[];
  total?: number;
  onOpen: (id: string) => void;
  onRestore: (note: NoteSummary) => void;
  onDeleteForever: (note: NoteSummary) => void;
}) {
  const viewMeta = documentViews.find((entry) => entry.id === view);
  const ViewIcon = viewMeta?.Icon ?? FileText;
  const title = query ? "搜索结果" : (viewMeta?.label ?? "文档");
  return (
    <section className="knowledge-results" aria-label="文档筛选结果">
      <header className="knowledge-results-heading">
        <div>
          <span className="knowledge-results-kicker">
            <ViewIcon size={14} aria-hidden />
            {query ? "知识库搜索" : "文档视图"}
          </span>
          <h1>{title}</h1>
          {query && <p>搜索「{query}」</p>}
        </div>
        {typeof total === "number" && !loading && (
          <span className="knowledge-results-count">{total} 篇</span>
        )}
      </header>
      {loading && <p role="status">正在加载文档…</p>}
      {!loading && total === 0 && (
        <div className="knowledge-results-empty">
          <ViewIcon size={28} strokeWidth={1.4} aria-hidden />
          <p>没有符合条件的文档</p>
        </div>
      )}
      {!!items.length && (
        <ul className="knowledge-filtered">
          {items.map((note) => (
            <li key={note.id} className="knowledge-doc-row">
              <button
                type="button"
                className="knowledge-doc-open"
                aria-label={note.title}
                onClick={() => onOpen(note.id)}
              >
                <span
                  className={`knowledge-doc-icon${note.is_home ? " is-home" : ""}`}
                >
                  {note.is_home ? (
                    <Home size={18} aria-hidden />
                  ) : (
                    <FileText size={18} aria-hidden />
                  )}
                </span>
                <span className="knowledge-doc-body">
                  <span className="knowledge-doc-title-row">
                    <span className="knowledge-doc-title">{note.title}</span>
                    <span className="knowledge-doc-flags" aria-hidden>
                      {note.pinned && <Pin size={14} />}
                      {note.favorite && <Star size={14} fill="currentColor" />}
                    </span>
                  </span>
                  {note.excerpt && (
                    <span className="knowledge-doc-excerpt">
                      {note.excerpt}
                    </span>
                  )}
                  <span className="knowledge-doc-meta">
                    {note.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="thought-tag">
                        {tag}
                      </span>
                    ))}
                    <time dateTime={note.updated_at}>
                      {relativeTime(note.updated_at)}
                    </time>
                  </span>
                </span>
              </button>
              {view === "trash" && (
                <div className="knowledge-doc-actions">
                  <button type="button" onClick={() => onRestore(note)}>
                    恢复
                  </button>
                  <button type="button" onClick={() => onDeleteForever(note)}>
                    永久删除
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
