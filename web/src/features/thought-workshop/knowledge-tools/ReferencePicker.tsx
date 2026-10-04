import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { thoughtKeys } from "../queryKeys";
import { useDocumentAccess } from "../DocumentAccess";
import type { DocumentReference } from "./ContentNodes";

export function ReferencePicker({
  choose,
  close,
  title = "引用文档",
  confirmLabel = "插入引用",
  allowCustomLabel = true,
}: {
  choose: (reference: DocumentReference) => void;
  close: () => void;
  title?: string;
  confirmLabel?: string;
  allowCustomLabel?: boolean;
}) {
  const access = useDocumentAccess();
  const [query, setQuery] = useState(""),
    [customLabel, setCustomLabel] = useState("");
  const [selected, setSelected] = useState<DocumentReference | null>(null);
  const search = useInfiniteQuery({
    queryKey: thoughtKeys.search({
      query,
      title_only: true,
      picker: true,
      access: access.namespace,
    }),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      access.searchNotes({ query, title_only: true }, pageParam, signal),
    getNextPageParam: (last, pages) => {
      const count = pages.reduce((sum, page) => sum + page.items.length, 0);
      return count < last.total ? count : undefined;
    },
    retry: false,
  });
  return (
    <ConfirmDialog
      open
      title={title}
      confirmLabel={confirmLabel}
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
            {allowCustomLabel && (
              <input
                aria-label="引用显示文字"
                value={customLabel}
                maxLength={240}
                onChange={(event) => setCustomLabel(event.target.value)}
                placeholder="显示文字（默认跟随标题）"
              />
            )}
          </div>
          {selected && <p>已选择：{selected.label}</p>}
          <div className="thought-tools-list">
            <strong>
              {access.community ? "可访问的社区文章" : "Workspace 文档"}
            </strong>
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
          </div>
        </div>
      }
    />
  );
}
