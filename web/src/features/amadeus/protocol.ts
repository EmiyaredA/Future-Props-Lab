export type Conversation = {
  id: string;
  title: string;
  model_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type Reference = {
  id: string;
  windowId?: number;
  window_id?: number;
  application: string;
  name: string;
  value: string;
  source: string;
  thumbnail?: string;
};

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
  references: Reference[];
  created_at: string;
  run_id?: string | null;
  status?: string;
};

export type SavedAction = {
  id: string;
  tool_name: string;
  status: string;
  arguments: Record<string, unknown>;
  result?: Record<string, unknown>;
  created_at: string;
};

export type Detail = {
  conversation: Conversation;
  messages: ChatMessage[];
  actions: SavedAction[];
};

export type Context = {
  windowId: number;
  application?: string;
  projectId?: string;
  selection?: { name: string; value: string };
  unsaved?: boolean;
  focused: boolean;
  path?: string;
  userId?: string;
  workspaceId?: string;
};

export type ModelOption = { id: string; label: string };
export type WorkFile = {
  kind: string;
  name: string;
  bytes: number;
  sha256: string;
};

export type Capability = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  status: string;
  revision: number;
  parameters_schema?: Record<string, unknown>;
  default_version?: string;
  latest_version?: string;
  sensitive_result?: boolean;
  status_message?: string;
};

export type Approval = {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  arguments_sha256: string;
  conversationId: string;
  runId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type WorkerEvent = {
  type: "rpc" | "delta" | "message" | "tool" | "done" | "error" | "stopped";
  id?: number | string;
  method?: string;
  payload?: unknown;
  text?: string;
  name?: string;
  status?: string;
  message?: string;
  result?: unknown;
};

export type Run = {
  id: string;
  conversation_id: string;
  model_id: string;
  status: string;
  partial_text: string;
  error_message?: string | null;
};

export type RunDetail = {
  run: Run;
  events: Array<{
    sequence: number;
    kind: string;
    payload: Record<string, unknown>;
  }>;
};

export type AvatarState =
  "idle" | "listening" | "thinking" | "tool" | "success" | "error" | "paused";

export const avatarStateLabels: Record<AvatarState, string> = {
  idle: "待命",
  listening: "聆听中",
  thinking: "思考中",
  tool: "执行中",
  success: "已完成",
  error: "需要关注",
  paused: "已暂停",
};

export function dateGroup(value: string) {
  const today = new Date();
  const item = new Date(value);
  if (item.toDateString() === today.toDateString()) return "今天";
  today.setDate(today.getDate() - 1);
  return item.toDateString() === today.toDateString() ? "昨天" : "更早";
}

export function compactContext(items: Context[]) {
  return `${items.length} 个窗口 · ${new Set(items.map((item) => item.application || "研究所")).size} 个应用`;
}

export function safeReadPath(value: unknown) {
  const path = String((value as { path?: string })?.path || "");
  if (path.includes("..") || /%2e|%2f|%5c/i.test(path))
    throw new Error("读取路径无效");
  const resolved = new URL(path, window.location.origin);
  if (
    resolved.origin !== window.location.origin ||
    !/^\/v1\/(video-editor|visual-workshop|thought-workshop|presentation-workshop|galgame-workshop|audio-annotation|director-desk|motion-compositor)(?:\/[a-zA-Z0-9_/?=&.%-]*)?$/.test(
      path,
    ) ||
    resolved.pathname !== path.split("?", 1)[0]
  )
    throw new Error("只能读取已授权的应用项目");
  return path;
}
