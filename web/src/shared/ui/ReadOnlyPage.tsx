import { LoadingState } from "@shared/ui/LoadingState";
import { useState, type ReactNode } from "react";
import "./read-only-page.css";
export function ReadOnlyPage({
  title,
  children,
  error,
  loading = false,
  onBack,
}: {
  title: string;
  children?: ReactNode;
  error?: unknown;
  loading?: boolean;
  onBack?: () => void;
}) {
  return (
    <section className="readonly-page">
      <header>
        {onBack ? (
          <button className="btn small" onClick={onBack}>
            返回列表
          </button>
        ) : null}
        <div>
          <h1>{title}</h1>
          <p className="readonly-badge">
            只读成员 · 可浏览、播放和下载已有内容
          </p>
        </div>
      </header>
      {loading ? <LoadingState label="正在加载…" variant="region" /> : null}
      {error ? (
        <p role="alert">
          {error instanceof Error ? error.message : "内容无法读取"}
        </p>
      ) : (
        children
      )}
    </section>
  );
}
export function ReadOnlyCollection({
  items,
  onOpen,
}: {
  items: readonly { id: string; title: string; description?: string }[];
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = items.filter((i) =>
    i.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <input
        className="readonly-search"
        aria-label="搜索内容"
        placeholder="搜索名称…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="readonly-collection">
        {filtered.map((i) => (
          <button
            className="readonly-card"
            key={i.id}
            onClick={() => onOpen(i.id)}
          >
            <strong>{i.title || "未命名"}</strong>
            {i.description ? <span>{i.description}</span> : null}
            <small>查看内容 →</small>
          </button>
        ))}
      </div>
      {!filtered.length ? <p>暂无匹配的内容。</p> : null}
    </>
  );
}
