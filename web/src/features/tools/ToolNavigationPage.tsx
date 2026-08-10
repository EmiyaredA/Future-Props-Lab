import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, ExternalLink, Search, Star, Tag } from "lucide-react";
import {
  getToolNavigationState,
  recordToolUse,
  setToolFavorite,
  type ToolNavigationItem,
  type ToolNavigationState,
} from "@features/tools/api";
import {
  categoryLabel,
  POPULAR_TAGS,
  TOOL_BY_ID,
  TOOL_CATEGORIES,
  TOOLS,
  type ToolCategory,
  type ToolDefinition,
} from "@features/tools/catalog";
import { relativeTime } from "@shared/lib/date";
import "@features/tools/tool-navigation.css";

const STATE_KEY = ["tool-navigation-state"] as const;

function mergeStateItem(
  state: ToolNavigationState | undefined,
  item: ToolNavigationItem,
): ToolNavigationState {
  const items =
    state?.items.filter((current) => current.tool_id !== item.tool_id) ?? [];
  return { items: [item, ...items] };
}

function optimisticItem(
  state: ToolNavigationState | undefined,
  toolId: string,
): ToolNavigationItem {
  return (
    state?.items.find((item) => item.tool_id === toolId) ?? {
      tool_id: toolId,
      is_favorite: false,
      favorite_updated_at: null,
      last_used_at: null,
      use_count: 0,
    }
  );
}

function ToolListItem({
  tool,
  meta,
  onOpen,
  showTime = false,
}: {
  tool: ToolDefinition;
  meta: ToolNavigationItem;
  onOpen: (tool: ToolDefinition) => void;
  showTime?: boolean;
}) {
  const Icon = tool.icon;
  return (
    <button
      className="tool-side-item"
      type="button"
      onClick={() => onOpen(tool)}
    >
      <span className="tool-side-icon">
        <Icon aria-hidden />
      </span>
      <span>
        <strong>{tool.name}</strong>
        <small>
          {showTime && meta.last_used_at
            ? relativeTime(meta.last_used_at, "")
            : categoryLabel(tool.category)}
        </small>
      </span>
      {tool.target.kind === "external" ? <ExternalLink aria-hidden /> : null}
    </button>
  );
}

export function ToolNavigationPage({
  onOpenInternal,
}: {
  onOpenInternal: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | ToolCategory>("all");
  const [tag, setTag] = useState("");
  const [notice, setNotice] = useState("");

  const stateQuery = useQuery({
    queryKey: STATE_KEY,
    queryFn: getToolNavigationState,
  });

  const favoriteMutation = useMutation({
    mutationFn: ({ toolId, favorite }: { toolId: string; favorite: boolean }) =>
      setToolFavorite(toolId, favorite),
    onMutate: async ({ toolId, favorite }) => {
      await queryClient.cancelQueries({ queryKey: STATE_KEY });
      const previous = queryClient.getQueryData<ToolNavigationState>(STATE_KEY);
      const current = optimisticItem(previous, toolId);
      queryClient.setQueryData<ToolNavigationState>(
        STATE_KEY,
        mergeStateItem(previous, {
          ...current,
          is_favorite: favorite,
          favorite_updated_at: favorite ? new Date().toISOString() : null,
        }),
      );
      setNotice("");
      return { previous };
    },
    onSuccess: (item) => {
      queryClient.setQueryData<ToolNavigationState>(STATE_KEY, (state) =>
        mergeStateItem(state, item),
      );
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(STATE_KEY, context?.previous);
      setNotice("收藏状态保存失败，请稍后重试。");
    },
  });

  const usageMutation = useMutation({
    mutationFn: (toolId: string) => recordToolUse(toolId),
    onMutate: async (toolId) => {
      await queryClient.cancelQueries({ queryKey: STATE_KEY });
      const previous = queryClient.getQueryData<ToolNavigationState>(STATE_KEY);
      const current = optimisticItem(previous, toolId);
      queryClient.setQueryData<ToolNavigationState>(
        STATE_KEY,
        mergeStateItem(previous, {
          ...current,
          last_used_at: new Date().toISOString(),
          use_count: current.use_count + 1,
        }),
      );
      setNotice("");
      return { previous };
    },
    onSuccess: (item) => {
      queryClient.setQueryData<ToolNavigationState>(STATE_KEY, (state) =>
        mergeStateItem(state, item),
      );
    },
    onError: (_error, _toolId, context) => {
      queryClient.setQueryData(STATE_KEY, context?.previous);
      setNotice("最近使用记录保存失败，但工具仍可正常使用。");
    },
  });

  const stateById = useMemo(
    () => new Map(stateQuery.data?.items.map((item) => [item.tool_id, item])),
    [stateQuery.data],
  );

  const filteredTools = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return TOOLS.filter((tool) => {
      if (category !== "all" && tool.category !== category) return false;
      if (
        tag &&
        !tool.tags.some(
          (value) =>
            value.toLocaleLowerCase("zh-CN") === tag.toLocaleLowerCase("zh-CN"),
        )
      ) {
        return false;
      }
      if (!needle) return true;
      return [
        tool.name,
        tool.description,
        categoryLabel(tool.category),
        ...tool.tags,
      ]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(needle);
    });
  }, [category, query, tag]);

  const favorites = useMemo(
    () =>
      (stateQuery.data?.items ?? [])
        .filter((item) => item.is_favorite && TOOL_BY_ID.has(item.tool_id))
        .sort((left, right) =>
          String(right.favorite_updated_at).localeCompare(
            String(left.favorite_updated_at),
          ),
        )
        .slice(0, 5),
    [stateQuery.data],
  );

  const recent = useMemo(
    () =>
      (stateQuery.data?.items ?? [])
        .filter((item) => item.last_used_at && TOOL_BY_ID.has(item.tool_id))
        .sort((left, right) =>
          String(right.last_used_at).localeCompare(String(left.last_used_at)),
        )
        .slice(0, 5),
    [stateQuery.data],
  );

  const openTool = (tool: ToolDefinition) => {
    if (tool.target.kind === "external") {
      window.open(tool.target.href, "_blank", "noopener,noreferrer");
    } else {
      onOpenInternal(tool.target.path);
    }
    usageMutation.mutate(tool.id);
  };

  const submitSearch = (event: FormEvent) => event.preventDefault();

  return (
    <section className="page tools-page">
      <header className="tools-header">
        <h1>工具导航</h1>
        <p>汇集常用研发工具，快速查找并开始使用</p>
      </header>

      <form className="tools-search" onSubmit={submitSearch} role="search">
        <Search aria-hidden />
        <input
          aria-label="搜索工具"
          placeholder="搜索工具名称、功能或关键词…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">搜索</button>
      </form>

      <div className="tools-categories" aria-label="工具分类">
        {TOOL_CATEGORIES.map((item) => (
          <button
            key={item.value}
            type="button"
            className={category === item.value ? "active" : ""}
            aria-pressed={category === item.value}
            onClick={() => setCategory(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="tools-tags">
        <span>
          <Tag aria-hidden />
          热门标签
        </span>
        {POPULAR_TAGS.map((item) => (
          <button
            key={item}
            type="button"
            className={tag === item ? "active" : ""}
            aria-pressed={tag === item}
            onClick={() => setTag((current) => (current === item ? "" : item))}
          >
            {item}
          </button>
        ))}
      </div>

      {notice ? (
        <div className="tools-notice" role="status">
          {notice}
        </div>
      ) : null}

      <div className="tools-layout">
        <div className="tool-grid" aria-live="polite">
          {filteredTools.map((tool) => {
            const Icon = tool.icon;
            const meta = stateById.get(tool.id);
            const favorite = meta?.is_favorite ?? false;
            return (
              <article className="tool-card" key={tool.id}>
                <button
                  className="tool-card-open"
                  type="button"
                  onClick={() => openTool(tool)}
                  aria-label={`打开${tool.name}`}
                >
                  <span className="tool-card-icon">
                    <Icon aria-hidden />
                  </span>
                  <span className="tool-card-copy">
                    <strong>{tool.name}</strong>
                    <small>{tool.description}</small>
                  </span>
                </button>
                <button
                  className={`tool-favorite${favorite ? " active" : ""}`}
                  type="button"
                  aria-label={`${favorite ? "取消收藏" : "收藏"}${tool.name}`}
                  aria-pressed={favorite}
                  onClick={() =>
                    favoriteMutation.mutate({
                      toolId: tool.id,
                      favorite: !favorite,
                    })
                  }
                >
                  <Star aria-hidden />
                </button>
                <span className="tool-category">
                  {categoryLabel(tool.category)}
                </span>
                {tool.target.kind === "external" ? (
                  <span className="tool-external" aria-label="外部工具">
                    <ExternalLink aria-hidden />
                  </span>
                ) : null}
              </article>
            );
          })}
          {filteredTools.length === 0 ? (
            <div className="tools-empty tools-empty-grid">
              <Search aria-hidden />
              <strong>没有找到匹配的工具</strong>
              <span>尝试更换关键词、分类或热门标签。</span>
            </div>
          ) : null}
        </div>

        <aside className="tools-side" aria-label="工具使用状态">
          <section className="card tool-side-card">
            <header>
              <h2>常用工具</h2>
              <Star aria-hidden />
            </header>
            {stateQuery.isError ? (
              <div className="tools-empty">
                <strong>收藏状态暂时无法读取</strong>
                <button type="button" onClick={() => void stateQuery.refetch()}>
                  重新加载
                </button>
              </div>
            ) : favorites.length ? (
              favorites.map((item) => {
                const tool = TOOL_BY_ID.get(item.tool_id)!;
                return (
                  <ToolListItem
                    key={item.tool_id}
                    tool={tool}
                    meta={item}
                    onOpen={openTool}
                  />
                );
              })
            ) : (
              <div className="tools-empty">
                <Star aria-hidden />
                <strong>还没有收藏工具</strong>
                <span>点击卡片右上角的星标即可收藏。</span>
              </div>
            )}
          </section>

          <section className="card tool-side-card">
            <header>
              <h2>最近使用</h2>
              <Clock3 aria-hidden />
            </header>
            {recent.length ? (
              recent.map((item) => {
                const tool = TOOL_BY_ID.get(item.tool_id)!;
                return (
                  <ToolListItem
                    key={item.tool_id}
                    tool={tool}
                    meta={item}
                    onOpen={openTool}
                    showTime
                  />
                );
              })
            ) : (
              <div className="tools-empty">
                <Clock3 aria-hidden />
                <strong>暂无使用记录</strong>
                <span>打开工具后会在这里显示最近记录。</span>
              </div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
