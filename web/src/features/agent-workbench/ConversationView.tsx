import "./conversation.css";
import { useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDown,
  ChevronDown,
  FileCode2,
  LoaderCircle,
  Send,
  UserRound,
} from "lucide-react";
import { AgentLogo } from "@features/code-agents";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  getHistory,
  displayTime,
  agentName,
  type Conversation,
  type HistoryEntry,
} from "./api";
import { workbenchKeys } from "./queryKeys";

function Message({
  entry,
  agent,
  sessionId,
}: {
  entry: HistoryEntry;
  agent: Conversation["agent_id"];
  sessionId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const body = expanded ? entry.text : entry.text.slice(0, 24000);
  const tool = ["tool_call", "tool_result", "thinking"].includes(entry.kind);
  return (
    <article className={`aw-message is-${entry.role}`}>
      <div className="aw-message-avatar">
        {entry.role === "user" ? (
          <UserRound size={20} />
        ) : (
          <AgentLogo id={agent} size={22} />
        )}
      </div>
      <div className="aw-message-content">
        <div className="aw-message-byline">
          <strong>
            {entry.role === "user"
              ? "我"
              : entry.role === "tool"
                ? "工具结果"
                : entry.role === "system"
                  ? "会话记录"
                  : agentName(agent)}
          </strong>
          <time>{displayTime(entry.timestamp)}</time>
        </div>
        {tool ? (
          <details className="aw-tool">
            <summary>
              <ChevronDown size={15} />
              <FileCode2 size={16} />
              <span>
                {entry.tool_name ||
                  (entry.kind === "thinking"
                    ? "思考过程"
                    : entry.kind === "tool_call"
                      ? "工具调用"
                      : "工具结果")}
              </span>
            </summary>
            <pre>{body}</pre>
          </details>
        ) : (
          <div className="aw-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={{
                img: () => <span className="aw-subtle">[图片引用]</span>,
                a: ({ children, href }) =>
                  /^https?:\/\//.test(href ?? "") ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {children}
                    </a>
                  ) : (
                    <span>{children}</span>
                  ),
              }}
            >
              {body}
            </ReactMarkdown>
          </div>
        )}
        {entry.text.length > 24000 && (
          <button className="aw-link" onClick={() => setExpanded(!expanded)}>
            {expanded
              ? "收起长内容"
              : `展开完整内容（${entry.text.length.toLocaleString()} 字符）`}
          </button>
        )}
        {entry.attachments.map((attachment) => {
          const id = String(attachment.id ?? "");
          const base = String(import.meta.env.VITE_API_BASE || "").replace(
            /\/$/,
            "",
          );
          return (
            <a
              className="aw-link"
              key={id}
              href={`${base}/v1/agent-workbench/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(id)}`}
            >
              下载附件：{String(attachment.name ?? "文件")}
            </a>
          );
        })}
        {["compaction", "branch_summary"].includes(entry.kind) && (
          <span className="aw-badge">
            {entry.kind === "compaction" ? "上下文压缩" : "分支摘要"}
          </span>
        )}
      </div>
    </article>
  );
}

export function ConversationView({
  item,
  owner,
  paused,
}: {
  item: Conversation;
  owner: string;
  paused: boolean;
}) {
  const [branch, setBranch] = useState<string>();
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const olderHeight = useRef<number | null>(null);
  const history = useInfiniteQuery({
    queryKey: workbenchKeys.history(owner, item.id, branch),
    queryFn: ({ pageParam, signal }) =>
      getHistory(item.id, pageParam, branch, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchOnWindowFocus: !paused,
  });
  const pages = history.data?.pages ?? [];
  const unique = new Map<string, HistoryEntry>();
  [...pages]
    .reverse()
    .forEach((page) =>
      page.items.forEach((entry) => unique.set(entry.id, entry)),
    );
  const messages = [...unique.values()].sort((a, b) => a.ordinal - b.ordinal);
  const version = history.dataUpdatedAt;
  const seenVersion = useRef(0);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (olderHeight.current !== null) {
      node.scrollTop += node.scrollHeight - olderHeight.current;
      olderHeight.current = null;
    } else if (atBottom) {
      node.scrollTop = node.scrollHeight;
    } else if (version && seenVersion.current !== version) setHasNew(true);
    seenVersion.current = version;
  }, [version, atBottom]);
  const toBottom = () => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
    setAtBottom(true);
    setHasNew(false);
  };
  const branches = pages[0]?.branches ?? [];
  return (
    <>
      {branches.length > 1 && (
        <div className="aw-branch">
          <span>会话分支</span>
          <CustomSelect
            ariaLabel="Pi 会话分支"
            value={branch ?? pages[0]?.selected_branch ?? ""}
            options={branches.map((id, index) => ({
              value: id,
              label: `分支 ${index + 1} · ${id.slice(0, 12)}`,
            }))}
            onChange={(id) => {
              setBranch(id);
              setAtBottom(true);
            }}
          />
        </div>
      )}
      <div
        className="aw-messages"
        ref={scroller}
        aria-label="会话记录"
        onScroll={() => {
          const node = scroller.current;
          if (node) {
            const bottom =
              node.scrollHeight - node.scrollTop - node.clientHeight < 64;
            setAtBottom(bottom);
            if (bottom) setHasNew(false);
          }
        }}
      >
        {history.hasNextPage && (
          <button
            className="aw-load"
            disabled={history.isFetchingNextPage}
            onClick={() => {
              olderHeight.current = scroller.current?.scrollHeight ?? null;
              void history.fetchNextPage();
            }}
          >
            {history.isFetchingNextPage ? "正在加载…" : "加载更早记录"}
          </button>
        )}
        {history.isPending && (
          <div className="aw-empty">
            <LoaderCircle className="aw-spin" />
            正在读取会话…
          </div>
        )}
        {history.error && (
          <div className="aw-error" role="alert">
            {history.error.message}
            <button className="aw-link" onClick={() => void history.refetch()}>
              重新读取
            </button>
          </div>
        )}
        {!history.isPending && !history.error && !messages.length && (
          <div className="aw-empty">
            <FileCode2 size={32} />
            <strong>暂无可展示消息</strong>
            <p>同步到完整记录后会自动显示。部分工具仅在一轮结束后保存内容。</p>
          </div>
        )}
        {messages.map((entry) => (
          <Message
            key={entry.id}
            entry={entry}
            agent={item.agent_id}
            sessionId={item.id}
          />
        ))}
      </div>
      {hasNew && (
        <button className="aw-new" onClick={toBottom}>
          <ArrowDown size={14} />
          有新内容
        </button>
      )}
      <footer className="aw-composer">
        <textarea
          aria-label="继续对话（待接入）"
          disabled
          placeholder="当前支持查看与同步，继续对话待接入"
          rows={2}
        />
        <div>
          <span>
            <AgentLogo id={item.agent_id} size={16} />
            {item.native_model || agentName(item.agent_id)}
            <span className="aw-badge">只读</span>
          </span>
          <button disabled className="aw-send" aria-label="发送（待接入）">
            <Send size={18} />
          </button>
        </div>
        <p>
          {paused
            ? "已暂停当前视图跟随，原 Agent 继续运行。"
            : "新增内容自动同步。原会话的运行与权限由原端管理。"}
        </p>
      </footer>
    </>
  );
}
