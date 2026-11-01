import { useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAccountId } from "@platform/auth/AccountAccess";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { thoughtKeys } from "../queryKeys";
import { officialPath } from "../community/legacyReference";
import { listPublications } from "../community/api";
import { getNote, type KnowledgeBase } from "../api";
import {
  globalSearch,
  listFilters,
  saveFilter,
  updateFilter,
  deleteFilter,
  recentDocuments,
  type SearchCriteria,
} from "./api";
import "./knowledge-tools.css";

export function DiscoveryPanel({
  projects,
  navigate,
  close,
}: {
  projects: KnowledgeBase[];
  navigate: (href: string) => void;
  close: () => void;
}) {
  const user = useAccountId() ?? "",
    workspace = useAccountId() ?? "",
    client = useQueryClient();
  const [criteria, setCriteria] = useState<SearchCriteria>({
    query: "",
    tag: "",
    favorite: false,
    title_only: false,
    knowledge_base_id: null,
  });
  const [input, setInput] = useState<{
      title: string;
      initial?: string;
      apply: (name: string) => Promise<unknown>;
    } | null>(null),
    [error, setError] = useState("");
  const search = useInfiniteQuery({
    queryKey: thoughtKeys.search(criteria),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      globalSearch(criteria, pageParam, signal),
    getNextPageParam: (last, pages) => {
      const count = pages.reduce((sum, page) => sum + page.items.length, 0);
      return count < last.total && last.items.length ? count : undefined;
    },
    retry: false,
  });
  const filters = useQuery({
    queryKey: thoughtKeys.filters(user, workspace),
    queryFn: listFilters,
    enabled: !!user && !!workspace,
    retry: false,
  });
  const recent = useQuery({
    queryKey: thoughtKeys.recent(user, workspace),
    queryFn: recentDocuments,
    enabled: !!user && !!workspace,
    retry: false,
  });
  const official = useQuery({
    queryKey: thoughtKeys.communityList(user, {
      query: criteria.query,
      official: true,
      discovery: true,
    }),
    queryFn: () =>
      criteria.tag || criteria.knowledge_base_id
        ? Promise.resolve([])
        : listPublications(
            criteria.query ?? "",
            false,
            criteria.favorite ?? false,
            0,
            undefined,
            true,
          ),
    retry: false,
  });
  const run = async (work: () => Promise<unknown>) => {
    setError("");
    try {
      await work();
      await client.invalidateQueries({
        queryKey: thoughtKeys.filters(user, workspace),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "操作失败");
    }
  };
  const find = (href: string) =>
    navigate(
      href +
        (criteria.query ? `?find=${encodeURIComponent(criteria.query)}` : ""),
    );
  return (
    <section className="thought-search-panel" aria-label="全局搜索">
      <div className="thought-tools">
        <strong>全局搜索与最近访问</strong>
        <button className="btn" onClick={close}>
          关闭搜索
        </button>
      </div>
      <div className="thought-tools">
        <input
          aria-label="全局搜索文本"
          placeholder="标题、正文或标签…"
          maxLength={500}
          value={criteria.query ?? ""}
          onChange={(event) =>
            setCriteria({ ...criteria, query: event.target.value })
          }
        />
        <CustomSelect
          ariaLabel="搜索知识库范围"
          value={criteria.knowledge_base_id ?? ""}
          options={[
            { value: "", label: "全部知识库与官方文档" },
            ...projects.map((p) => ({ value: p.id, label: p.title })),
          ]}
          onChange={(value) =>
            setCriteria({ ...criteria, knowledge_base_id: value || null })
          }
        />
        <input
          aria-label="搜索标签"
          maxLength={40}
          value={criteria.tag ?? ""}
          placeholder="标签"
          onChange={(event) =>
            setCriteria({ ...criteria, tag: event.target.value })
          }
        />
        <button
          className="btn"
          aria-pressed={criteria.title_only}
          onClick={() =>
            setCriteria({ ...criteria, title_only: !criteria.title_only })
          }
        >
          仅标题
        </button>
        <button
          className="btn"
          aria-pressed={criteria.favorite}
          onClick={() =>
            setCriteria({ ...criteria, favorite: !criteria.favorite })
          }
        >
          仅收藏
        </button>
        {!!user && (
          <button
            className="btn"
            onClick={() =>
              setInput({
                title: "保存筛选",
                apply: (name) => saveFilter(name, criteria),
              })
            }
          >
            保存筛选
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {(filters.data?.length ?? 0) > 0 && (
        <div className="thought-tools">
          {filters.data?.map((filter) => (
            <span key={filter.id}>
              <button
                className="btn"
                onClick={() => setCriteria(filter.criteria)}
              >
                {filter.name}
              </button>
              <button
                className="btn small"
                aria-label={`重命名筛选${filter.name}`}
                onClick={() =>
                  setInput({
                    title: "重命名筛选",
                    initial: filter.name,
                    apply: (name) => updateFilter(filter, name),
                  })
                }
              >
                改名
              </button>
              <button
                className="btn small"
                aria-label={`删除筛选${filter.name}`}
                onClick={() => void run(() => deleteFilter(filter))}
              >
                删除
              </button>
            </span>
          ))}
        </div>
      )}
      <h3>账号文档 · {search.data?.pages[0]?.total ?? 0} 篇</h3>
      {search.isError && (
        <p role="alert">
          {search.error.message}
          <button className="btn" onClick={() => void search.refetch()}>
            重试
          </button>
        </p>
      )}
      <div className="thought-tools-list">
        {search.data?.pages
          .flatMap((page) => page.items)
          .map((item) => (
            <button
              className="btn"
              key={item.id}
              onClick={() =>
                find(
                  `/apps/thought-workshop/knowledge-bases/${item.knowledge_base_id}/documents/${item.id}`,
                )
              }
            >
              <strong>{item.title}</strong>
              <small>
                {" "}
                · {[item.knowledge_base_title, ...item.path].join(" / ")}
              </small>
              <p>{item.snippet}</p>
            </button>
          ))}
      </div>
      {search.hasNextPage && (
        <button
          className="btn"
          disabled={search.isFetchingNextPage}
          onClick={() => void search.fetchNextPage()}
        >
          加载更多搜索结果
        </button>
      )}
      <h3>官方发布 · {official.data?.length ?? 0} 个</h3>
      {official.error && (
        <p role="alert">
          {official.error.message}
          <button className="btn" onClick={() => void official.refetch()}>
            重试
          </button>
        </p>
      )}
      <div className="thought-tools-list">
        {official.data?.map((publication) => (
          <button
            className="btn"
            key={publication.id}
            onClick={() =>
              find(`/apps/thought-workshop/community/${publication.id}`)
            }
          >
            <strong>{publication.title}</strong> · {publication.author}
            <p>{publication.description}</p>
          </button>
        ))}
      </div>
      <h3>最近访问</h3>
      <div className="thought-tools-list">
        {recent.data?.map((item) => (
          <button
            className="btn"
            key={item.resource_id}
            onClick={() =>
              void run(async () => {
                if (item.resource_id.startsWith("official/")) {
                  const [, library, document] = item.resource_id.split("/");
                  navigate(officialPath(library, document));
                } else {
                  const note = await getNote(item.resource_id);
                  navigate(
                    `/apps/thought-workshop/knowledge-bases/${note.knowledge_base_id}/documents/${note.id}`,
                  );
                }
              })
            }
          >
            {item.title}
          </button>
        ))}
      </div>
      <TextInputDialog
        open={!!input}
        title={input?.title ?? ""}
        initialValue={input?.initial}
        label="名称"
        onCancel={() => setInput(null)}
        onConfirm={(name) => {
          const current = input;
          setInput(null);
          if (current) void run(() => current.apply(name));
        }}
      />
    </section>
  );
}
