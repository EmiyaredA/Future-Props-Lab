import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type Source = components["schemas"]["WorkbenchSourceOut"];
export type Conversation = components["schemas"]["WorkbenchSessionOut"];
export type HistoryEntry = components["schemas"]["WorkbenchEntryOut"];
export type Candidate = components["schemas"]["WorkbenchCandidate"];
export type AgentId = Source["agent_id"];
export type Filters = {
  q?: string;
  agent_id?: string;
  origin?: string;
  project?: string;
  archived?: boolean;
  favorite?: boolean;
};

export const agents: { id: AgentId; name: string; short: string }[] = [
  { id: "codex", name: "Codex", short: "Codex" },
  { id: "claude-code", name: "Claude Code", short: "Claude" },
  { id: "opencode", name: "OpenCode", short: "OpenCode" },
  { id: "dsh", name: "DeepSeek Harness", short: "DSH" },
  { id: "pi", name: "Pi", short: "Pi" },
];
export const agentName = (id: string) =>
  agents.find((a) => a.id === id)?.name ?? id;
export const originName = (origins: string[]) =>
  origins.length
    ? origins.map((o) => (o === "app" ? "APP" : "CLI")).join(" / ")
    : "来源待确认";
export const syncName = (mode?: string) =>
  mode === "native_events"
    ? "原生事件"
    : mode === "api_poll"
      ? "原生 API 校准"
      : "日志跟随";

export const getSources = async (signal?: AbortSignal) =>
  unwrap(await api.GET("/v1/agent-workbench/sources", { signal }));
export const getCandidates = async (signal?: AbortSignal) =>
  unwrap(await api.GET("/v1/agent-workbench/candidates", { signal }));
export const getSessions = async (
  filters: Filters,
  cursor?: string,
  signal?: AbortSignal,
) =>
  unwrap(
    await api.GET("/v1/agent-workbench/sessions", {
      params: { query: { ...filters, cursor, limit: 50 } },
      signal,
    }),
  );
export const getSession = async (id: string, signal?: AbortSignal) =>
  unwrap(
    await api.GET("/v1/agent-workbench/sessions/{session_id}", {
      params: { path: { session_id: id } },
      signal,
    }),
  );
export const getHistory = async (
  id: string,
  before?: number,
  branch?: string,
  signal?: AbortSignal,
) =>
  unwrap(
    await api.GET("/v1/agent-workbench/sessions/{session_id}/history", {
      params: {
        path: { session_id: id },
        query: { before, branch, limit: 50 },
      },
      signal,
    }),
  );
export const bindSource = async (
  body: components["schemas"]["WorkbenchSourceCreate"],
) => unwrap(await api.POST("/v1/agent-workbench/sources", { body }));
export const changeSource = async (source: Source, enabled: boolean) =>
  unwrap(
    await api.PATCH("/v1/agent-workbench/sources/{source_id}", {
      params: { path: { source_id: source.id } },
      body: { expected_revision: source.revision, enabled },
    }),
  );
export const removeSource = async (source: Source) =>
  unwrap(
    await api.DELETE("/v1/agent-workbench/sources/{source_id}", {
      params: {
        path: { source_id: source.id },
        query: { expected_revision: source.revision },
      },
    }),
  );
export const scanSource = async (id: string) =>
  unwrap(
    await api.POST("/v1/agent-workbench/sources/{source_id}/scan", {
      params: { path: { source_id: id } },
    }),
  );
export const setFavorite = async (item: Conversation) =>
  unwrap(
    await api.PATCH("/v1/agent-workbench/sessions/{session_id}/preferences", {
      params: { path: { session_id: item.id } },
      body: { expected_revision: item.revision, favorite: !item.favorite },
    }),
  );
export const clearCopy = async (item: Conversation) =>
  unwrap(
    await api.DELETE("/v1/agent-workbench/sessions/{session_id}/copy", {
      params: {
        path: { session_id: item.id },
        query: { expected_revision: item.revision },
      },
    }),
  );

export function displayTime(value?: string | null) {
  if (!value) return "尚未同步";
  const date = new Date(
    /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`,
  );
  if (Number.isNaN(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
