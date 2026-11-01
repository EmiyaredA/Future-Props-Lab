import { useDeferredValue, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  Cable,
  ChevronDown,
  Copy,
  FolderOpen,
  Info,
  List,
  MessagesSquare,
  Pause,
  Play,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { AgentLogo } from "@features/code-agents";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  agentName,
  agents,
  clearCopy,
  displayTime,
  originName,
  setFavorite,
  syncName,
  type Conversation,
  type Filters,
} from "./api";
import { ConversationView } from "./ConversationView";
import { SourceManager } from "./SourceManager";
import { useWorkbench } from "./useWorkbench";
import "./workbench.css";

type Props = {
  scopeKey: string;
  sessionId?: string;
  sourcesPage: boolean;
  onOpenSession: (id?: string) => void;
  onSources: () => void;
  onBack: () => void;
};

export function AgentWorkbenchPage({
  scopeKey,
  sessionId,
  sourcesPage,
  onOpenSession,
  onSources,
  onBack,
}: Props) {
  const [search, setSearch] = useState("");
  const [agent, setAgent] = useState("");
  const [origin, setOrigin] = useState("");
  const [project, setProject] = useState("");
  const [view, setView] = useState("all");
  const [drawer, setDrawer] = useState(false);
  const [info, setInfo] = useState(true);
  const [mobileInfo, setMobileInfo] = useState(false);
  const [clear, setClear] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const q = useDeferredValue(search);
  const canWrite = useAccountPermission("content.write");
  const filters: Filters = {
    q,
    agent_id: agent || undefined,
    origin: origin || undefined,
    project: project || undefined,
    archived: view === "archived" ? true : undefined,
    favorite: view === "favorite",
  };
  const data = useWorkbench(scopeKey, filters, sessionId);
  const sources = data.sources.data ?? [];
  const sessions = data.list.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = data.detail.data;
  const selectedSources = selected
    ? sources.filter((source) =>
        (selected.source_ids ?? []).includes(source.id),
      )
    : [];
  const grouped = new Map<string, Conversation[]>();
  sessions.forEach((item) => {
    const key = `${item.agent_id}:${originName(item.origins)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  });
  const projects = [
    ...new Set(sessions.map((item) => item.cwd).filter(Boolean)),
  ];
  const sidebar = (
    <>
      <div className="aw-search">
        <Search size={17} />
        <input
          aria-label="搜索会话或项目"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索会话或项目"
        />
        <button
          aria-label="添加会话来源"
          onClick={() => {
            setDrawer(false);
            onSources();
          }}
        >
          <Plus size={20} />
        </button>
      </div>
      <div className="aw-agent-tabs" aria-label="Agent 筛选">
        {[{ id: "", short: "全部" }, ...agents].map((item) => (
          <button
            key={item.id}
            aria-pressed={agent === item.id}
            className={agent === item.id ? "is-active" : ""}
            onClick={() => setAgent(item.id)}
          >
            {item.short}
          </button>
        ))}
      </div>
      <div className="aw-filter-row">
        <CustomSelect
          ariaLabel="会话来源"
          value={origin}
          onChange={setOrigin}
          options={[
            { value: "", label: "全部来源" },
            { value: "app", label: "APP" },
            { value: "cli", label: "CLI" },
            { value: "unknown", label: "来源待确认" },
          ]}
        />
        <CustomSelect
          ariaLabel="会话范围"
          value={view}
          onChange={setView}
          options={[
            { value: "all", label: "全部会话" },
            { value: "favorite", label: "已收藏" },
            { value: "archived", label: "已归档" },
          ]}
        />
      </div>
      {(projects.length > 0 || project) && (
        <div className="aw-project-filter">
          <CustomSelect
            ariaLabel="按项目筛选"
            value={project}
            onChange={setProject}
            options={[
              { value: "", label: "全部项目" },
              ...[...new Set([...(project ? [project] : []), ...projects])].map(
                (path) => ({
                  value: path,
                  label: path.split("/").filter(Boolean).at(-1) ?? path,
                  description: path,
                }),
              ),
            ]}
          />
        </div>
      )}
      <div className="aw-session-list" aria-label="已有会话">
        {data.list.isPending && <p className="aw-note">正在读取已有会话…</p>}
        {data.list.error && (
          <div className="aw-error" role="alert">
            {data.list.error.message}
            <button
              className="aw-link"
              onClick={() => void data.list.refetch()}
            >
              重新读取
            </button>
          </div>
        )}
        {!data.list.isPending && !sessions.length && (
          <div className="aw-list-empty">
            <MessagesSquare size={28} />
            <strong>
              {sources.length ? "暂无匹配会话" : "连接你的本机会话"}
            </strong>
            <p>
              {sources.length
                ? "可调整筛选，或检查来源的同步状态。"
                : "绑定来源后，APP 和 CLI 的已有记录将在这里出现。"}
            </p>
            <button
              className="aw-button"
              onClick={() => {
                onSources();
                setDrawer(false);
              }}
            >
              管理来源
            </button>
          </div>
        )}
        {[...grouped].map(([key, items]) => (
          <section className="aw-session-group" key={key}>
            <button
              className="aw-group-heading"
              aria-expanded={!collapsed.includes(key)}
              onClick={() =>
                setCollapsed(
                  collapsed.includes(key)
                    ? collapsed.filter((id) => id !== key)
                    : [...collapsed, key],
                )
              }
            >
              <ChevronDown
                size={15}
                className={collapsed.includes(key) ? "is-collapsed" : ""}
              />
              <span>
                {agentName(items[0].agent_id)} · {originName(items[0].origins)}
              </span>
              <small>{items.length}</small>
            </button>
            {!collapsed.includes(key) &&
              items.map((item) => (
                <button
                  className={`aw-session-row ${item.id === sessionId && !sourcesPage ? "is-active" : ""}`}
                  key={item.id}
                  aria-current={
                    item.id === sessionId && !sourcesPage ? "page" : undefined
                  }
                  onClick={() => {
                    onOpenSession(item.id);
                    setDrawer(false);
                  }}
                >
                  <span
                    className={`aw-dot ${(item.source_ids ?? []).some((id) => sources.some((s) => s.id === id && s.enabled && s.status === "following")) ? "is-live" : ""}`}
                  />
                  <span className="aw-session-label">
                    <strong>{item.alias || item.title}</strong>
                    <small>
                      {item.cwd.split("/").filter(Boolean).at(-1) ||
                        "项目待确认"}
                    </small>
                  </span>
                  <span className="aw-session-time">
                    {item.favorite && <Star size={12} />}
                    {displayTime(item.updated_at || item.last_synced_at)}
                  </span>
                </button>
              ))}
          </section>
        ))}
        {data.list.hasNextPage && (
          <button
            className="aw-load"
            disabled={data.list.isFetchingNextPage}
            onClick={() => void data.list.fetchNextPage()}
          >
            {data.list.isFetchingNextPage ? "正在加载…" : "加载更多会话"}
          </button>
        )}
      </div>
      <button
        className="aw-sidebar-footer"
        onClick={() => {
          onSources();
          setDrawer(false);
        }}
      >
        <Cable size={16} />
        <span>
          {sources.length} 个来源 · {sessions.length} 个已加载会话
        </span>
        <Info size={15} />
      </button>
    </>
  );
  const metadata = selected && (
    <>
      <header className="aw-info-heading">
        <h2>会话信息</h2>
        <button
          className="aw-icon-button"
          aria-label="收起会话信息"
          onClick={() => {
            setInfo(false);
            setMobileInfo(false);
          }}
        >
          <X size={16} />
        </button>
      </header>
      <dl className="aw-metadata">
        <dt>Agent</dt>
        <dd>{agentName(selected.agent_id)}</dd>
        <dt>来源</dt>
        <dd>{originName(selected.origins)}</dd>
        <dt>项目</dt>
        <dd title={selected.cwd}>{selected.cwd || "原生记录未提供"}</dd>
        <dt>同步方式</dt>
        <dd>
          {selectedSources.length
            ? [
                ...new Set(
                  selectedSources.map((source) => syncName(source.sync_mode)),
                ),
              ].join(" / ")
            : "来源已解除绑定"}
        </dd>
        <dt>最后同步</dt>
        <dd>{displayTime(selected.last_synced_at)}</dd>
        <dt>模型</dt>
        <dd>{selected.native_model || "原生记录未提供"}</dd>
        <dt>原生标识</dt>
        <dd className="aw-native-id">
          {selected.native_id}
          <button
            className="aw-icon-button"
            aria-label="复制原生标识"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(selected.native_id);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy size={13} />
          </button>
          {copied && <small>已复制</small>}
        </dd>
        {selected.parent_native_id && (
          <>
            <dt>父会话</dt>
            <dd>{selected.parent_native_id}</dd>
          </>
        )}
        <dt>状态</dt>
        <dd>{selected.archived ? "已归档" : "只读跟随"}</dd>
      </dl>
      <section className="aw-evidence">
        <h3>来源依据</h3>
        {selected.evidence.length ? (
          selected.evidence.map((item) => <p key={item}>{item}</p>)
        ) : (
          <p>原生记录缺少 APP / CLI 标记，暂不推断来源。</p>
        )}
      </section>
      <section className="aw-info-actions">
        <h3>相关操作</h3>
        <button className="aw-button" onClick={data.togglePaused}>
          {data.paused ? <Play size={16} /> : <Pause size={16} />}
          <span>
            {data.paused ? "恢复跟随" : "暂停跟随"}
            <small>仅影响当前视图，原 Agent 继续运行</small>
          </span>
        </button>
        <button
          className="aw-button"
          disabled={!canWrite}
          onClick={() => void data.mutate(() => setFavorite(selected))}
        >
          <Star size={16} />
          <span>{selected.favorite ? "取消收藏" : "收藏会话"}</span>
        </button>
        {selected.cwd && (
          <button
            className="aw-button"
            onClick={() => {
              setProject(selected.cwd);
              setMobileInfo(false);
              setDrawer(true);
            }}
          >
            <FolderOpen size={16} />
            只看这个项目
          </button>
        )}
        <button className="aw-button" onClick={onSources}>
          <Cable size={16} />
          管理会话来源
        </button>
        <button
          className="aw-link"
          disabled={
            !canWrite || selectedSources.some((source) => source.enabled)
          }
          onClick={() => setClear(true)}
        >
          <Trash2 size={14} />
          清除 FPL 阅读副本
        </button>
      </section>
    </>
  );
  return (
    <section className="agent-workbench" aria-label="Agent 工作台">
      <header className="aw-toolbar">
        <div>
          <button className="aw-link" onClick={onBack}>
            <ArrowLeft size={16} />
            全部应用
          </button>
          <span className="aw-toolbar-divider">/</span>
          <strong>Agent 工作台</strong>
        </div>
        <nav aria-label="工作台导航">
          <button
            className={`aw-nav-button ${!sourcesPage ? "is-active" : ""}`}
            onClick={() => onOpenSession(sessionId)}
          >
            <MessagesSquare size={16} />
            会话
          </button>
          <button
            className={`aw-nav-button ${sourcesPage ? "is-active" : ""}`}
            onClick={onSources}
          >
            <Cable size={16} />
            来源
          </button>
        </nav>
        <span
          className={`aw-status ${data.connection === "live" ? "is-live" : ""}`}
        >
          <span className="aw-dot" />
          {data.connection === "live"
            ? "同步已连接"
            : data.connection === "reconnecting"
              ? "正在重连"
              : data.connection === "closed"
                ? "连接已关闭"
                : "正在连接"}
        </span>
      </header>
      {data.updateError && (
        <div className="aw-error" role="alert">
          {data.updateError}
        </div>
      )}
      {data.sources.error && (
        <div className="aw-error" role="alert">
          {data.sources.error.message}
        </div>
      )}
      <div
        className={`aw-layout ${info && selected && !sourcesPage ? "has-info" : ""}`}
      >
        <aside className="aw-sidebar">{sidebar}</aside>
        <main className="aw-conversation">
          <header className="aw-conversation-heading">
            <button
              className="aw-icon-button aw-mobile-list"
              aria-label="打开会话列表"
              onClick={() => setDrawer(true)}
            >
              <List size={20} />
            </button>
            {selected && !sourcesPage ? (
              <>
                <div className="aw-agent-symbol">
                  <AgentLogo id={selected.agent_id} size={25} />
                </div>
                <div className="aw-conversation-title">
                  <h1>{selected.alias || selected.title}</h1>
                  <p>
                    {agentName(selected.agent_id)} ·{" "}
                    {originName(selected.origins)}
                    <span className="aw-dot" />
                    {data.paused ? "当前视图已暂停" : "只读同步"}
                  </p>
                </div>
                <button
                  className="aw-icon-button aw-info-toggle"
                  aria-label="会话信息"
                  onClick={() => {
                    setInfo(!info);
                    setMobileInfo(true);
                  }}
                >
                  <Info size={20} />
                </button>
              </>
            ) : (
              <>
                <MessagesSquare size={23} />
                <div>
                  <h1>{sourcesPage ? "会话来源" : "本机 Agent 会话"}</h1>
                  <p>APP 与 CLI 的已有记录，集中查看与跟随</p>
                </div>
              </>
            )}
          </header>
          {sourcesPage ? (
            <SourceManager
              owner={scopeKey}
              sources={sources}
              mutate={data.mutate}
            />
          ) : selected ? (
            <ConversationView
              key={selected.id}
              item={selected}
              owner={scopeKey}
              paused={data.paused}
            />
          ) : data.detail.isFetching && sessionId ? (
            <div className="aw-empty">正在读取会话…</div>
          ) : (
            <div className="aw-empty">
              <MessagesSquare size={42} />
              <h2>{sessionId ? "会话暂不可读" : "从一个已有会话开始"}</h2>
              <p>
                {data.detail.error?.message ||
                  "在左侧选择已有记录；也可以连接本机来源，发现 APP 和 CLI 会话。"}
              </p>
              <button className="aw-button is-primary" onClick={onSources}>
                <Cable size={16} />
                管理来源
              </button>
            </div>
          )}
        </main>
        {info && selected && !sourcesPage && (
          <aside className="aw-info">{metadata}</aside>
        )}
      </div>
      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <Dialog.Portal>
          <Dialog.Overlay className="aw-drawer-overlay" />
          <Dialog.Content className="aw-drawer aw-session-drawer">
            <div className="aw-drawer-heading">
              <Dialog.Title>已有会话</Dialog.Title>
              <Dialog.Close
                className="aw-icon-button"
                aria-label="关闭会话列表"
              >
                <X size={18} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              搜索、筛选并打开本机已有 APP 与 CLI 会话。
            </Dialog.Description>
            {sidebar}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={mobileInfo} onOpenChange={setMobileInfo}>
        <Dialog.Portal>
          <Dialog.Overlay className="aw-drawer-overlay aw-mobile-info" />
          <Dialog.Content className="aw-drawer aw-mobile-info">
            <Dialog.Title className="sr-only">会话信息</Dialog.Title>
            <Dialog.Description className="sr-only">
              当前会话的来源、项目与同步状态。
            </Dialog.Description>
            {metadata}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        open={clear && !!selected}
        title="清除 FPL 阅读副本"
        description="仅清除 FPL 保存的这条会话副本，不删除原生记录。之后重新启用来源同步时可再次读取。"
        confirmLabel="清除副本"
        onCancel={() => setClear(false)}
        onConfirm={async () => {
          if (selected) await data.mutate(() => clearCopy(selected));
          setClear(false);
          onOpenSession();
        }}
      />
    </section>
  );
}
