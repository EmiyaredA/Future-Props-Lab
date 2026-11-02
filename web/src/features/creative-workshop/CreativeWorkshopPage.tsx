import { LoadingState } from "@shared/ui/LoadingState";
import { useEffect, useMemo, useState } from "react";
import { fetchApiJson } from "@platform/api/client";
import {
  createCreative,
  importCreative,
  listCreative,
  type CreativeItem,
  type CreativeKind,
} from "./api";
import { Detail } from "./CreativeDetail";
import { Editor } from "./CreativeEditor";
import {
  errorText,
  initialDraft,
  kinds,
  labels,
  type Mode,
  type Nav,
} from "./shared";
import { Cover } from "./Cover";
import "./creative-workshop.css";

function Header({
  mode,
  canWrite,
  navigate,
}: {
  mode: Mode;
  canWrite: boolean;
  navigate: Nav;
}) {
  return (
    <header className="creative-header">
      <div>
        <h1>创意工坊</h1>
        <p>
          {mode === "creative-workshop-mine"
            ? "管理已发布作品与草稿"
            : "发现、分享与组合可复用的工具能力"}
        </p>
      </div>
      <div className="creative-header-actions">
        <button
          className={
            mode === "creative-workshop"
              ? "creative-tab active"
              : "creative-tab"
          }
          onClick={() => navigate("creative-workshop")}
        >
          创意广场
        </button>
        <button
          className={
            mode === "creative-workshop-mine"
              ? "creative-tab active"
              : "creative-tab"
          }
          onClick={() => navigate("creative-workshop-mine")}
        >
          我的创作
        </button>
        {canWrite && (
          <button
            className="creative-primary"
            onClick={() => navigate("creative-workshop-new")}
          >
            ＋ 发布创作
          </button>
        )}
      </div>
    </header>
  );
}

function ItemCard({
  item,
  onOpen,
  mine = false,
}: {
  item: CreativeItem;
  onOpen: () => void;
  mine?: boolean;
}) {
  return (
    <button className="creative-card" onClick={onOpen}>
      <Cover item={item} />
      <div className="creative-card-body">
        <div className="creative-card-top">
          <span className="creative-badge">{labels[item.kind]}</span>
          {mine && (
            <span className={`creative-status creative-status--${item.status}`}>
              {item.status === "published"
                ? `已发布 · v${item.version}`
                : item.status === "draft"
                  ? "草稿"
                  : "已撤回"}
            </span>
          )}
        </div>
        <strong>{item.title || "未命名创作"}</strong>
        <p>{item.summary || "还没有填写简介"}</p>
        <div className="creative-card-foot">
          <span>{item.author_name}</span>
          <span>{mine ? "继续编辑 →" : "查看详情 →"}</span>
        </div>
      </div>
    </button>
  );
}

function Listing({
  mine,
  canWrite,
  navigate,
}: {
  mine: boolean;
  canWrite: boolean;
  navigate: Nav;
}) {
  const [items, setItems] = useState<CreativeItem[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    listCreative({ mine, kind, q: query })
      .then((result) => {
        if (active) {
          setItems(result.items);
          setCursor(result.next_cursor);
          setError("");
        }
      })
      .catch((cause) => active && setError(errorText(cause)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [mine, kind, query]);
  const filtered =
    mine && status !== "all"
      ? items.filter((item) => item.status === status)
      : items;
  return (
    <>
      <div className="creative-toolbar">
        <label className="creative-search">
          <span aria-hidden>⌕</span>
          <input
            aria-label="搜索创作"
            placeholder="搜索名称、用途或关键词"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="creative-filter" aria-label="类型筛选">
          <button
            className={kind === "all" ? "active" : ""}
            onClick={() => setKind("all")}
          >
            全部
          </button>
          {kinds.map((value) => (
            <button
              key={value}
              className={kind === value ? "active" : ""}
              onClick={() => setKind(value)}
            >
              {labels[value]}
            </button>
          ))}
        </div>
      </div>
      {mine && (
        <div
          className="creative-filter creative-status-filter"
          aria-label="发布状态"
        >
          {[
            ["all", "全部创作"],
            ["published", "已发布"],
            ["draft", "草稿"],
            ["withdrawn", "已撤回"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={status === value ? "active" : ""}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="creative-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <LoadingState
          label="正在加载创作…"
          variant="region"
          className="creative-empty"
        />
      ) : filtered.length ? (
        <div className="creative-grid">
          {filtered.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              mine={mine}
              onOpen={() =>
                navigate(
                  mine
                    ? "creative-workshop-editor"
                    : "creative-workshop-detail",
                  item.id,
                )
              }
            />
          ))}
        </div>
      ) : (
        <div className="creative-empty">
          {mine ? "这里还没有创作。" : "暂时没有符合条件的公开创作。"}
          {mine && canWrite && (
            <button onClick={() => navigate("creative-workshop-new")}>
              创建第一件作品
            </button>
          )}
        </div>
      )}
      {cursor && (
        <div className="creative-load">
          <button
            onClick={async () => {
              try {
                const page = await listCreative({
                  mine,
                  kind,
                  q: query,
                  cursor,
                });
                setItems((previous) => [...previous, ...page.items]);
                setCursor(page.next_cursor);
              } catch (cause) {
                setError(errorText(cause));
              }
            }}
          >
            加载更多
          </button>
        </div>
      )}
    </>
  );
}

function NewItem({
  canWrite,
  canInstall,
  navigate,
}: {
  canWrite: boolean;
  canInstall: boolean;
  navigate: Nav;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importKind, setImportKind] = useState<CreativeKind>("tool_api");
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [sourceId, setSourceId] = useState("");
  useEffect(() => {
    if (!canInstall || importKind === "bundle") return;
    const path =
      importKind === "tool_api"
        ? "tool-apis"
        : importKind === "mcp"
          ? "mcp"
          : "skills";
    fetchApiJson<{ items: { id: string; name: string }[] }>(
      `/v1/integrations/${path}`,
    )
      .then((result) => {
        setSources(result.items);
        setSourceId(result.items[0]?.id || "");
      })
      .catch((cause) => setError(errorText(cause)));
  }, [canInstall, importKind]);
  const create = async (kind: CreativeKind) => {
    setBusy(true);
    setError("");
    try {
      const item = await createCreative(initialDraft(kind));
      navigate("creative-workshop-editor", item.id);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!canWrite)
    return <p className="creative-empty">当前账号没有内容编辑权限。</p>;
  return (
    <>
      <div className="creative-section-heading">
        <div>
          <h2>发布什么能力？</h2>
          <p>可以单独分享能力，也可以把多个公开能力组合成方案包。</p>
        </div>
        <button
          className="creative-text-button"
          onClick={() => navigate("creative-workshop-mine")}
        >
          ← 返回我的创作
        </button>
      </div>
      <div className="creative-kind-grid">
        {kinds.map((kind) => (
          <button
            key={kind}
            className="creative-kind-card"
            disabled={busy}
            onClick={() => create(kind)}
          >
            <span className="creative-kind-icon">
              {kind === "bundle"
                ? "✦"
                : kind === "tool_api"
                  ? "⌘"
                  : kind === "mcp"
                    ? "◈"
                    : "✧"}
            </span>
            <strong>{labels[kind]}</strong>
            <p>
              {kind === "bundle"
                ? "组合公开能力，附上使用说明和建议步骤。"
                : kind === "tool_api"
                  ? "分享 HTTP 工具接口的公开配置。"
                  : kind === "mcp"
                    ? "分享 HTTP 或 stdio MCP 的安装信息。"
                    : "上传经过安全校验的 Skill ZIP。"}
            </p>
            <span>新建 →</span>
          </button>
        ))}
      </div>
      {canInstall && (
        <div className="creative-import">
          <div>
            <h3>从当前账号的集成导入</h3>
            <p>只带入公开字段。凭据、密钥与本机环境配置不会发布。</p>
          </div>
          <div className="creative-import-form">
            <select
              aria-label="导入类型"
              value={importKind}
              onChange={(event) =>
                setImportKind(event.target.value as CreativeKind)
              }
            >
              {kinds
                .filter((kind) => kind !== "bundle")
                .map((kind) => (
                  <option key={kind} value={kind}>
                    {labels[kind]}
                  </option>
                ))}
            </select>
            <select
              aria-label="选择集成"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
            <button
              disabled={!sourceId || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const item = await importCreative(importKind, sourceId);
                  navigate("creative-workshop-editor", item.id);
                } catch (cause) {
                  setError(errorText(cause));
                } finally {
                  setBusy(false);
                }
              }}
            >
              导入草稿
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="creative-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function CreativeWorkshopPage({
  mode,
  itemId,
  canWrite,
  canInstall,
  navigate,
}: {
  mode: Mode;
  itemId?: string;
  canWrite: boolean;
  canInstall: boolean;
  navigate: Nav;
}) {
  const title = useMemo(
    () => (mode === "creative-workshop" ? "创意广场" : "创意工坊"),
    [mode],
  );
  useEffect(() => {
    document.title = `${title} — Future Props Lab`;
  }, [title]);
  return (
    <main className="page creative-page">
      <Header mode={mode} canWrite={canWrite} navigate={navigate} />
      {mode === "creative-workshop" && (
        <Listing mine={false} canWrite={canWrite} navigate={navigate} />
      )}
      {mode === "creative-workshop-mine" && (
        <Listing mine canWrite={canWrite} navigate={navigate} />
      )}
      {mode === "creative-workshop-new" && (
        <NewItem
          canWrite={canWrite}
          canInstall={canInstall}
          navigate={navigate}
        />
      )}
      {mode === "creative-workshop-editor" && (
        <Editor itemId={itemId} canWrite={canWrite} navigate={navigate} />
      )}
      {mode === "creative-workshop-detail" && (
        <Detail itemId={itemId} canInstall={canInstall} navigate={navigate} />
      )}
    </main>
  );
}
