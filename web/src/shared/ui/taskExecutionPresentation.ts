import type { components } from "@generated/api";

export type TaskExecutionInfo = components["schemas"]["TaskExecutionInfo"];

export function executionDetails(
  info: TaskExecutionInfo | null | undefined,
  now = Date.now(),
): string | undefined {
  if (!info) return;
  const parts: string[] = [];
  if (info.queue_position) parts.push(`队列第 ${info.queue_position} 位`);
  if (info.node_id) parts.push(`当前节点 ${info.node_label || info.node_id}`);
  if (info.step != null && info.total_steps) {
    parts.push(`采样 ${info.step}/${info.total_steps} 步`);
  }
  if (info.reported_progress != null) {
    parts.push(`上游报告 ${info.reported_progress}%`);
  }
  if (info.live_status === "reconnecting") parts.push("实时连接重连中");
  else if (info.live_status === "connecting") parts.push("连接实时状态中");
  else if (info.live_status === "connected") parts.push("实时连接已接通");
  const updated = Date.parse(info.updated_at);
  if (Number.isFinite(updated)) {
    const age = Math.max(0, Math.floor((now - updated) / 1000));
    parts.push(age < 10 ? "状态刚更新" : `状态 ${age} 秒前更新`);
  }
  if (info.last_event_at && now - Date.parse(info.last_event_at) > 60_000) {
    parts.push("采样信息暂未更新");
  }
  return parts.join(" · ");
}

export function samplingPercent(
  info: TaskExecutionInfo | null | undefined,
  now = Date.now(),
): number | undefined {
  if (
    !info ||
    info.phase !== "running" ||
    info.live_status !== "connected" ||
    info.step == null ||
    !info.total_steps ||
    !info.last_event_at ||
    !Number.isFinite(Date.parse(info.last_event_at)) ||
    now - Date.parse(info.last_event_at) > 60_000
  )
    return;
  return Math.max(
    0,
    Math.min(100, Math.round((100 * info.step) / info.total_steps)),
  );
}
