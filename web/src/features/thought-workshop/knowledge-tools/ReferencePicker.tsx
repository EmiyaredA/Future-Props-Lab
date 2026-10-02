import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { OFFICIAL_KNOWLEDGE_BASES } from "../official/catalog";
import { thoughtKeys } from "../queryKeys";
import { globalSearch } from "./api";
import type { DocumentReference } from "./ContentNodes";

export function ReferencePicker({
  choose,
  close,
}: {
  choose: (reference: DocumentReference) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState(""),
    [customLabel, setCustomLabel] = useState("");
  const [selected, setSelected] = useState<DocumentReference | null>(null);
  const search = useInfiniteQuery({
    queryKey: thoughtKeys.search({ query, title_only: true, picker: true }),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      globalSearch({ query, title_only: true }, pageParam, signal),
    getNextPageParam: (last, pages) => {
      const count = pages.reduce((sum, page) => sum + page.items.length, 0);
      return count < last.total ? count : undefined;
    },
    retry: false,
  });
  const official = OFFICIAL_KNOWLEDGE_BASES.flatMap((library) =>
    library.documents
      .filter((doc) =>
        `${library.title} ${doc.title}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      )
      .map((doc) => ({ library, doc })),
  );
  return (
    <ConfirmDialog
      open
      title="引用文档"
      confirmLabel="插入引用"
      onCancel={close}
      onConfirm={() => {
        if (selected)
          choose({ ...selected, customLabel: customLabel.trim() || null });
      }}
      description={
        <div>
          <div className="thought-tools">
            <input
              aria-label="搜索引用文档"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文档标题…"
            />
            <input
              aria-label="引用显示文字"
              value={customLabel}
              maxLength={240}
              onChange={(event) => setCustomLabel(event.target.value)}
              placeholder="显示文字（默认跟随标题）"
            />
          </div>
          {selected && <p>已选择：{selected.label}</p>}
          <div className="thought-tools-list">
            <strong>Workspace 文档</strong>
            {search.data?.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <button
                  className="btn"
                  key={item.id}
                  aria-pressed={selected?.noteId === item.id}
                  onClick={() =>
                    setSelected({
                      kind: "note",
                      noteId: item.id,
                      label: item.title,
                    })
                  }
                >
                  {item.title} · {item.knowledge_base_title}
                </button>
              ))}
            {search.isError && (
              <p role="alert">
                {search.error.message}
                <button className="btn" onClick={() => void search.refetch()}>
                  重试
                </button>
              </p>
            )}
            {search.hasNextPage && (
              <button
                className="btn"
                disabled={search.isFetchingNextPage}
                onClick={() => void search.fetchNextPage()}
              >
                加载更多
              </button>
            )}
            <strong>官方文章</strong>
            {official.map(({ library, doc }) => (
              <button
                className="btn"
                key={`${library.id}/${doc.id}`}
                aria-pressed={
                  selected?.libraryId === library.id &&
                  selected?.documentId === doc.id
                }
                onClick={() =>
                  setSelected({
                    kind: "official",
                    libraryId: library.id,
                    documentId: doc.id,
                    label: doc.title,
                  })
                }
              >
                {doc.title} · {library.title}
              </button>
            ))}
          </div>
        </div>
      }
    />
  );
}
