import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Card } from "../creative/api";
import { apiErrorMessage } from "@platform/api/errors";
import type { useProjectReferenceIssues } from "./useProjectReferenceIssues";

export function ProjectReferenceIssues({
  issues,
}: {
  issues: ReturnType<typeof useProjectReferenceIssues>;
}) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const client = useQueryClient();
  if (!issues.blocking) return null;
  if (issues.checking) return <small role="status">正在核对项目设定…</small>;
  if (issues.problem)
    return (
      <div role="alert">
        项目设定读取失败，暂不能生成。
        <button type="button" onClick={issues.retry}>
          重试核对
        </button>
      </div>
    );
  async function collect(card: Card) {
    setPending(card.id);
    setError("");
    try {
      await issues.collect?.(card);
      await client.invalidateQueries({ queryKey: ["visual-project-cards"] });
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setPending("");
    }
  }
  return (
    <div className="reference-upload-failures" role="alert">
      <strong>以下设定尚未收录到项目或已失效，请修复后生成。</strong>
      {issues.entries.map(({ id, card }) => (
        <div key={id}>
          <span>
            {card?.title ?? "不可用的设定卡"}
            {card?.archived ? "（已归档）" : ""}
          </span>
          {card && !card.archived && issues.collect && (
            <button
              type="button"
              disabled={Boolean(pending)}
              onClick={() => void collect(card)}
            >
              收录到项目：{card.title}
            </button>
          )}
        </div>
      ))}
      {error && <span>{error}</span>}
    </div>
  );
}
