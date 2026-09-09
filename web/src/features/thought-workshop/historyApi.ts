import { api, unwrap } from "@platform/api/client";
import type { components } from "@generated/api";
import { read } from "./api";

export type HistorySnapshot = components["schemas"]["ThoughtHistorySnapshot"];
export type HistorySummary = components["schemas"]["ThoughtHistorySummary"];
export const listHistory = (
  noteId: string,
  cursor: string | null,
  signal?: AbortSignal,
) =>
  read(
    async (signal) =>
      unwrap(
        await api.GET("/v1/thought-workshop/notes/{note_id}/history", {
          params: { path: { note_id: noteId }, query: { cursor, limit: 30 } },
          signal,
        }),
      ),
    signal,
  );
export const getHistory = (
  noteId: string,
  historyId: string,
  signal?: AbortSignal,
) =>
  read(
    async (signal) =>
      unwrap(
        await api.GET(
          "/v1/thought-workshop/notes/{note_id}/history/{history_id}",
          {
            params: { path: { note_id: noteId, history_id: historyId } },
            signal,
          },
        ),
      ),
    signal,
  );
export const restoreHistory = async (
  noteId: string,
  historyId: string,
  revision: number,
) =>
  unwrap(
    await api.POST(
      "/v1/thought-workshop/notes/{note_id}/history/{history_id}/restore",
      {
        params: { path: { note_id: noteId, history_id: historyId } },
        body: { expected_revision: revision },
      },
    ),
  );

export function historyTime(value: string, date = false) {
  const parsed = new Date(
    /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`,
  );
  return date
    ? parsed.toLocaleDateString("zh-CN")
    : parsed.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
}
