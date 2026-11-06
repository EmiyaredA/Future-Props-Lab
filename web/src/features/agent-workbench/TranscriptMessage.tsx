import { createContext, useContext, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  BookOpen,
  CircleHelp,
  Globe2,
  ChevronRight,
  CircleEllipsis,
  Search,
  Terminal,
} from "lucide-react";
import { AgentLogo } from "@features/code-agents";
import { agentName, displayTime, type Conversation } from "./api";
import { fileReference, type FileReference } from "./fileReferences";

// Stable renderers keep focused file links mounted during SSE/layout updates.
const FileNavigation = createContext<
  ((file: FileReference) => void) | undefined
>(undefined);
function TranscriptLink({
  children,
  href,
}: {
  children?: ReactNode;
  href?: string;
}) {
  const open = useContext(FileNavigation);
  const file = open && href ? fileReference(href) : undefined;
  return file ? (
    <button
      type="button"
      className="aw-file-link"
      data-file-path={file.path}
      data-file-line={file.line}
      onClick={() => open?.(file)}
    >
      {children}
    </button>
  ) : /^https?:\/\//.test(href ?? "") ? (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}
const markdownComponents = {
  img: () => <span className="aw-subtle">[图片引用]</span>,
  a: TranscriptLink,
};

export function TranscriptMessage({
  agent,
  role = "assistant",
  timestamp,
  children,
}: {
  agent: Conversation["agent_id"];
  role?: "user" | "assistant" | "system";
  timestamp?: string;
  children: ReactNode;
}) {
  return (
    <article className={`aw-message is-${role}`}>
      <div className="aw-message-content">
        <div className="aw-message-byline">
          {role === "assistant" && <AgentLogo id={agent} size={14} />}
          <strong
            className={role === "user" ? "aw-visually-hidden" : undefined}
          >
            {role === "user"
              ? "我"
              : role === "system"
                ? "会话记录"
                : agentName(agent)}
          </strong>
          {timestamp && (
            <time dateTime={timestamp}>{displayTime(timestamp)}</time>
          )}
        </div>
        <div className="aw-message-body">{children}</div>
      </div>
    </article>
  );
}

export function TranscriptText({
  text,
  raw = false,
  onOpenFile,
}: {
  text: string;
  raw?: boolean;
  onOpenFile?: (file: FileReference) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const body = expanded ? text : text.slice(0, 24000);
  return (
    <>
      {raw ? (
        <pre>{body}</pre>
      ) : (
        <div className="aw-prose">
          <FileNavigation value={onOpenFile}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[
                [rehypeHighlight, { detect: false, ignoreMissing: true }],
              ]}
              skipHtml
              components={markdownComponents}
            >
              {body}
            </ReactMarkdown>
          </FileNavigation>
        </div>
      )}
      {text.length > 24000 && (
        <button
          type="button"
          className="aw-link"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "收起长内容"
            : `展开完整内容（${text.length.toLocaleString()} 字符）`}
        </button>
      )}
    </>
  );
}

function activitySummary(names: string[], failed = 0) {
  const kinds = new Set(
    names.map((name) => {
      const tool = name.split(" · ")[0].toLowerCase();
      if (["read", "read_file", "list_files", "view_file"].includes(tool))
        return "读取文件";
      if (
        [
          "exec",
          "exec_command",
          "run_command",
          "bash",
          "shell",
          "terminal",
        ].includes(tool)
      )
        return "运行命令";
      if (["search", "grep", "glob", "rg"].includes(tool)) return "搜索";
      if (["web_search", "websearch"].includes(tool)) return "网页搜索";
      if (
        [
          "request_user_input",
          "ask_user_question",
          "askuserquestion",
          "question",
        ].includes(tool)
      )
        return "询问用户";
      if (["write", "write_file", "edit", "apply_patch"].includes(tool))
        return "编辑文件";
      return "";
    }),
  );
  const categories = [...kinds].filter((kind) => kind !== "");
  const title =
    categories.length === 1 && !kinds.has("") && names.length === 1
      ? {
          读取文件: "已读取文件",
          运行命令: "运行了命令",
          搜索: "已搜索",
          网页搜索: "已搜索网页",
          询问用户: "已询问用户",
          编辑文件: "编辑了文件",
        }[categories[0]]
      : [categories.join("、"), `${names.length} 项操作`]
          .filter(Boolean)
          .join(" · ");
  const icon = kinds.has("询问用户")
    ? "question"
    : kinds.has("网页搜索")
      ? "web"
      : kinds.has("读取文件")
        ? "read"
        : kinds.has("搜索")
          ? "search"
          : kinds.has("运行命令")
            ? "command"
            : "activity";
  return {
    title: `${title}${failed ? ` · ${failed} 项失败` : ""}`,
    icon,
  } as const;
}

export function TranscriptActivity({
  names,
  failed = 0,
  children,
  open,
  onToggle,
}: {
  names: string[];
  failed?: number;
  children: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  return (
    <TranscriptDisclosure
      {...activitySummary(names, failed)}
      open={open}
      onToggle={onToggle}
    >
      {children}
    </TranscriptDisclosure>
  );
}

export function TranscriptDisclosure({
  title,
  children,
  open,
  onToggle,
  icon,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  icon?: ReturnType<typeof activitySummary>["icon"];
}) {
  const Icon =
    icon &&
    {
      read: BookOpen,
      search: Search,
      command: Terminal,
      activity: CircleEllipsis,
      question: CircleHelp,
      web: Globe2,
    }[icon];
  return (
    <details
      className={`aw-tool${icon ? " aw-tool-group" : ""}`}
      open={open}
      onToggle={
        onToggle ? (event) => onToggle(event.currentTarget.open) : undefined
      }
    >
      <summary>
        <ChevronRight size={14} aria-hidden="true" />
        {Icon && <Icon size={14} aria-hidden="true" />}
        <span>{title}</span>
      </summary>
      <div className="aw-tool-content">{children}</div>
    </details>
  );
}
