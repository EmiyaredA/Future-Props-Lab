import type { Run, RunDetail, TokenUsage } from "./protocol";

export const usageFields = [
  ["total_tokens", "合计"],
  ["input_tokens", "输入"],
  ["output_tokens", "输出"],
  ["cached_input_tokens", "缓存读取"],
  ["cache_write_tokens", "缓存写入"],
  ["reasoning_tokens", "推理"],
] as const satisfies ReadonlyArray<readonly [keyof TokenUsage, string]>;

export const tokenCount = new Intl.NumberFormat("zh-CN");

export function conversationUsage(
  conversationId: string | undefined,
  history: RunDetail[],
  active: Run | null,
) {
  const snapshots = new Map<string, RunDetail>();
  for (const snapshot of history) {
    if (snapshot.run.conversation_id !== conversationId) continue;
    const previous = snapshots.get(snapshot.run.id);
    if (
      !previous ||
      (snapshot.events.at(-1)?.sequence ?? 0) >
        (previous.events.at(-1)?.sequence ?? 0) ||
      ((snapshot.events.at(-1)?.sequence ?? 0) ===
        (previous.events.at(-1)?.sequence ?? 0) &&
        (snapshot.run.updated_at ?? "") >= (previous.run.updated_at ?? ""))
    ) {
      snapshots.set(snapshot.run.id, snapshot);
    }
  }
  const runs = [...snapshots.values()].map(({ run }) => run);
  const live = active?.conversation_id === conversationId ? active : null;
  if (live && !snapshots.has(live.id)) runs.push(live);
  const latest = runs.reduce<Run | undefined>(
    (current, candidate) =>
      !current || (candidate.created_at ?? "") >= (current.created_at ?? "")
        ? candidate
        : current,
    undefined,
  );
  return {
    current: live ? (snapshots.get(live.id)?.run ?? live) : latest,
    active: !!live,
    runCount: runs.length,
    reportedRuns: runs.filter(({ usage }) =>
      usageFields.some(([field]) => usage?.[field] != null),
    ).length,
    rows: usageFields.map(([key, label]) => {
      const values = runs.flatMap(({ usage }) =>
        usage?.[key] == null ? [] : [usage[key]],
      );
      return {
        key,
        label,
        recorded: values.length,
        total: values.length
          ? values.reduce((sum, value) => sum + value, 0)
          : null,
      };
    }),
  };
}
