import { FormEvent, useMemo, useState } from "react";
import { ArrowRight, Clock3, Search, Sparkles, Tag } from "lucide-react";
import {
  APPLICATION_CATEGORIES,
  APPLICATION_TAGS,
  APPLICATIONS,
  categoryLabel,
  type ApplicationCategory,
  type ApplicationDefinition,
} from "@features/applications/catalog";
import "@features/applications/applications.css";

const RECENT_KEY = "future-props-recent-applications";

function recentIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function rememberApplication(id: string) {
  localStorage.setItem(
    RECENT_KEY,
    JSON.stringify(
      [id, ...recentIds().filter((value) => value !== id)].slice(0, 5),
    ),
  );
}

export function ApplicationCenterPage({
  onOpen,
}: {
  onOpen: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | ApplicationCategory>("all");
  const [tag, setTag] = useState("");
  const [recent, setRecent] = useState(recentIds);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return APPLICATIONS.filter((app) => {
      if (category !== "all" && app.category !== category) return false;
      if (tag && !app.capabilities.includes(tag)) return false;
      return (
        !needle ||
        [
          app.name,
          app.description,
          categoryLabel(app.category),
          ...app.capabilities,
        ]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(needle)
      );
    });
  }, [category, query, tag]);
  const open = (app: ApplicationDefinition) => {
    rememberApplication(app.id);
    setRecent(recentIds());
    onOpen(app.path);
  };
  const recentApps = recent
    .map((id) => APPLICATIONS.find((app) => app.id === id))
    .filter(Boolean) as ApplicationDefinition[];

  return (
    <section className="page applications-page">
      <header className="applications-header">
        <h1>AI应用</h1>
        <p>发现面向完整工作流的 AI 应用</p>
      </header>
      <form
        className="applications-search"
        role="search"
        onSubmit={(event: FormEvent) => event.preventDefault()}
      >
        <Search aria-hidden />
        <input
          aria-label="搜索AI应用"
          placeholder="搜索应用名称、能力或关键词…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button>搜索</button>
      </form>
      <div className="applications-categories" aria-label="应用分类">
        {APPLICATION_CATEGORIES.map((item) => (
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
      <div className="applications-tags">
        <span>
          <Tag aria-hidden />
          能力标签
        </span>
        {APPLICATION_TAGS.map((item) => (
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
      <div className="applications-layout">
        <div className="application-grid" aria-live="polite">
          {filtered.map((app) => {
            const Icon = app.icon;
            return (
              <article className="application-card" key={app.id}>
                <button
                  type="button"
                  aria-label={`打开${app.name}`}
                  onClick={() => open(app)}
                >
                  <span className="application-icon">
                    {app.brandImage ? (
                      <img src={app.brandImage} alt="" draggable={false} />
                    ) : (
                      <Icon aria-hidden />
                    )}
                  </span>
                  <span className="application-copy">
                    <span className="application-badge">
                      <Sparkles aria-hidden />
                      AI 应用
                    </span>
                    <strong>{app.name}</strong>
                    <small>{app.description}</small>
                    <span className="application-capabilities">
                      {app.capabilities.map((item) => (
                        <em key={item}>{item}</em>
                      ))}
                    </span>
                    <span className="application-open">
                      进入应用
                      <ArrowRight aria-hidden />
                    </span>
                  </span>
                </button>
              </article>
            );
          })}
          {filtered.length === 0 ? (
            <div className="application-empty">
              <Search aria-hidden />
              <strong>没有找到匹配的应用</strong>
              <span>尝试更换关键词、分类或能力标签。</span>
            </div>
          ) : null}
        </div>
        <aside className="application-recent card">
          <header>
            <h2>最近访问</h2>
            <Clock3 aria-hidden />
          </header>
          {recentApps.length ? (
            recentApps.map((app) => {
              const Icon = app.icon;
              return (
                <button key={app.id} type="button" onClick={() => open(app)}>
                  <span>
                    {app.brandImage ? (
                      <img src={app.brandImage} alt="" draggable={false} />
                    ) : (
                      <Icon aria-hidden />
                    )}
                  </span>
                  <span>
                    <strong>{app.name}</strong>
                    <small>{categoryLabel(app.category)}</small>
                  </span>
                  <ArrowRight aria-hidden />
                </button>
              );
            })
          ) : (
            <div className="application-recent-empty">
              <Clock3 aria-hidden />
              <strong>还没有访问记录</strong>
              <span>打开应用后会显示在这里。</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
