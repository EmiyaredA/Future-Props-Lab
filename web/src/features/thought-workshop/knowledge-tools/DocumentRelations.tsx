import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { thoughtKeys } from "../queryKeys";
import type { NoteSummary } from "../api";
import { useDocumentAccess } from "../DocumentAccess";
import "./knowledge-tools.css";

function chapterTitle(title: string) {
  const match = /^(\d{2})\s+(.+)$/.exec(title);
  return match
    ? { index: match[1], label: match[2] }
    : { index: "", label: title };
}
export function DocumentRelations({
  id,
  documents,
  open,
}: {
  id: string;
  documents: NoteSummary[];
  open: (id: string) => void;
}) {
  const access = useDocumentAccess();
  const [show, setShow] = useState(false);
  const links = useInfiniteQuery({
    queryKey: thoughtKeys.backlinks(
      access.community ? `${access.namespace}/${id}` : id,
    ),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => access.backlinks(id, pageParam),
    getNextPageParam: (last, pages) =>
      last.length === 40 ? pages.length * 40 : undefined,
    enabled: show,
    retry: false,
  });
  const children = documents.filter((item) => item.parent_id === id);
  return (
    <aside className="thought-subpages" aria-label="关联文档">
      {!!children.length && (
        <nav aria-label="子文档">
          <h3>子文档</h3>
          <ul className="thought-subpages-index">
            {children.map((item) => {
              const chapter = chapterTitle(item.title);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={item.title}
                    onClick={() => open(item.id)}
                  >
                    {chapter.index ? (
                      <span className="thought-subpage-index" aria-hidden>
                        {chapter.index}
                      </span>
                    ) : null}
                    <span>{chapter.label}</span>
                    <ChevronRight size={15} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <button
        type="button"
        className="thought-backlinks-toggle"
        aria-expanded={show}
        onClick={() => setShow(!show)}
      >
        反向链接
        <ChevronRight size={14} aria-hidden />
      </button>
      {show && (
        <div className="thought-tools-list">
          {links.data?.pages
            .flatMap((page) => page)
            .map((item) => (
              <a
                key={item.id}
                href={access.referenceHref(item.id, item.knowledge_base_id!)}
                onClick={(event) => {
                  if (!event.metaKey && !event.ctrlKey) {
                    event.preventDefault();
                    open(item.id);
                  }
                }}
              >
                {item.title}
                <small> · {item.excerpt}</small>
              </a>
            ))}
          {links.isSuccess && !links.data.pages[0]?.length && (
            <p>暂无引用此文档的页面</p>
          )}
          {links.isError && (
            <p role="alert">
              {links.error.message}
              <button
                type="button"
                className="btn"
                onClick={() => void links.refetch()}
              >
                重试
              </button>
            </p>
          )}
          {links.hasNextPage && (
            <button
              type="button"
              className="btn"
              onClick={() => void links.fetchNextPage()}
            >
              加载更多反向链接
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
