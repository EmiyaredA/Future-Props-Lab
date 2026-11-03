import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiErrorMessage } from "@platform/api/errors";
import { getValidationAttempts, reconcileValidationAttempt } from "./api";
import { integrationKeys } from "./queryKeys";

export function ValidationRecoveryPanel() {
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const key = integrationKeys.validationAttempts(offset);
  const [message, setMessage] = useState("");
  const attempts = useQuery({
    queryKey: key,
    queryFn: () => getValidationAttempts(offset),
  });
  const reconcile = useMutation({
    mutationFn: reconcileValidationAttempt,
    onSuccess: (result) => {
      setMessage(
        result.released
          ? "已确认结束并释放验证额度。"
          : "已确认结束，正在重试额度结算。",
      );
      setOffset(0);
      void client.invalidateQueries({
        queryKey: integrationKeys.validationAttemptsRoot,
      });
    },
    onError: (error) =>
      setMessage(apiErrorMessage(error, "回执检查失败，请稍后重试。")),
  });
  if (
    offset === 0 &&
    !attempts.data?.items.length &&
    !attempts.isError &&
    !message
  )
    return null;
  return (
    <section
      className="integration-recovery"
      aria-labelledby="validation-recovery-title"
    >
      <h2 id="validation-recovery-title">待核对的验证</h2>
      {attempts.isError ? (
        <p role="alert">无法读取待核对的验证，请稍后刷新。</p>
      ) : null}
      {attempts.data?.items.length ? (
        <p>
          结果未确认的验证会保留额度。检查只读取原有回执，不会重新执行；没有可信结束回执时继续保留。
        </p>
      ) : null}
      <ul>
        {attempts.data?.items.map((item) => (
          <li key={item.id}>
            <span>
              {item.kind === "mcp.validate" ? "MCP 验证" : "工具 API 验证"} ·{" "}
              {new Date(
                item.created_at.endsWith("Z")
                  ? item.created_at
                  : item.created_at + "Z",
              ).toLocaleString()}{" "}
              · {item.status === "unknown" ? "等待结束回执" : "等待额度结算"}
            </span>
            <button
              className="btn small"
              type="button"
              disabled={reconcile.isPending}
              onClick={() => reconcile.mutate(item.id)}
            >
              检查回执
            </button>
          </li>
        ))}
      </ul>
      {offset > 0 ? (
        <button
          className="btn small"
          type="button"
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          上一页
        </button>
      ) : null}
      {attempts.data?.has_more ? (
        <button
          className="btn small"
          type="button"
          onClick={() => setOffset(offset + 100)}
        >
          下一页
        </button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
