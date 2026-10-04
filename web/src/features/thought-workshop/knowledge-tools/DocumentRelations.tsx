import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { thoughtKeys } from "../queryKeys";
import type { NoteSummary } from "../api";
import { useDocumentAccess } from "../DocumentAccess";
export function DocumentRelations({
  id,
  isHome,
  documents,
  open,
}: {
  id: string;
  isHome: boolean;
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
  const children = documents.filter(
    (item) => item.parent_id === (isHome ? null : id),
  );
  return (
    <aside className="thought-subpages" aria-label="关联文档">
      {!!children.length && (
        <>
          <h3>{isHome ? "知识库目录" : "子文档"}</h3>
          <ul>
            {children.map((item) => (
              <li key={item.id}>
                <button className="btn" onClick={() => open(item.id)}>
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        className="btn"
        aria-expanded={show}
        onClick={() => setShow(!show)}
      >
        反向链接
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
              <button className="btn" onClick={() => void links.refetch()}>
                重试
              </button>
            </p>
          )}
          {links.hasNextPage && (
            <button className="btn" onClick={() => void links.fetchNextPage()}>
              加载更多反向链接
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
