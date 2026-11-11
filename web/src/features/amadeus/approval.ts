import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { fetchApiJson, requestApi } from "@platform/api/client";
import type { AmadeusPageBridge } from "./PageContext";
import type { AccountSessionContext } from "@features/accounts";
import type { Approval, Context, Detail } from "./protocol";

type ApprovalOptions = {
  allow: boolean;
  current: Approval | null;
  contexts: Context[];
  session: AccountSessionContext;
  bridge: AmadeusPageBridge;
  isCurrent: () => boolean;
  signal: AbortSignal;
  acceptDetail: (detail: Detail) => void;
  activeActionRef: MutableRefObject<{
    conversationId: string;
    actionId: string;
  } | null>;
  setError: Dispatch<SetStateAction<string>>;
  setScriptOutput: Dispatch<SetStateAction<string>>;
};

export function approvalTarget(
  action: Pick<Approval, "tool_name" | "arguments">,
) {
  const pathParams = action.arguments.path_params;
  const path =
    pathParams && typeof pathParams === "object"
      ? (pathParams as Record<string, unknown>)
      : {};
  const projectId =
    path.project_id ?? path.room_id ?? action.arguments.project_id;
  const elementId = typeof path.note_id === "string" ? path.note_id : undefined;
  const resource =
    action.tool_name === "video_timeline_batch"
      ? "video"
      : /^fpl_operation:([a-z_]+)\./.exec(action.tool_name)?.[1];
  return resource
    ? {
        resource,
        projectId:
          typeof projectId === "string" && projectId ? projectId : undefined,
        elementId,
      }
    : undefined;
}

export async function decideAmadeusApproval({
  allow,
  current,
  contexts,
  session,
  bridge,
  isCurrent,
  signal,
  acceptDetail,
  activeActionRef,
  setError,
  setScriptOutput,
}: ApprovalOptions) {
  if (!current || activeActionRef.current) return false;
  const conversationId = current.conversationId;
  const target = approvalTarget(current);
  const projectId = target?.projectId;
  if (
    allow &&
    typeof projectId === "string" &&
    contexts.some(
      (item) =>
        item.projectId === projectId &&
        item.unsaved &&
        item.userId === session.me.user.id &&
        item.accountId === session.me.user.id,
    )
  ) {
    setError("目标项目有未保存的编辑。请先在原窗口保存，再确认这项操作。");
    return false;
  }
  const report = (message: string) => {
    if (isCurrent()) setError(message);
  };
  const actionPath = `/v1/amadeus/conversations/${conversationId}/actions/${current.id}`;
  const reconcile = async () => {
    const snapshot = await fetchApiJson<Detail>(
      `/v1/amadeus/conversations/${conversationId}`,
      { signal },
    );
    if (isCurrent()) acceptDetail(snapshot);
    return snapshot.actions.find((item) => item.id === current.id)?.status;
  };
  const notifyProject = () => {
    if (target) void bridge.publishAmadeusMutation(target);
  };
  let receipt: string | undefined;
  activeActionRef.current = { conversationId, actionId: current.id };
  try {
    if (current.status === "pending")
      await fetchApiJson(`${actionPath}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arguments_sha256: current.arguments_sha256,
          approve: allow,
        }),
      });
    if (!allow) return (await reconcile()) === "rejected";
    let outcome: { status: string; result?: Record<string, unknown> };
    if (current.tool_name === "run_script") {
      const response = await requestApi(`${actionPath}/execute/stream`, {
        method: "POST",
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("脚本输出流不可用");
      const decoder = new TextDecoder();
      let buffer = "";
      let completed: typeof outcome | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as {
            type: string;
            text?: string;
            action?: typeof outcome;
            message?: string;
          };
          if (event.type === "output" && isCurrent())
            setScriptOutput((previous) => previous + (event.text || ""));
          else if (event.type === "end" && event.action)
            completed = event.action;
          else if (event.type === "error")
            throw new Error(event.message || "脚本执行失败");
        }
      }
      if (!completed) throw new Error("脚本输出流提前中断");
      outcome = completed;
    } else {
      outcome = await fetchApiJson<{
        status: string;
        result?: Record<string, unknown>;
      }>(`${actionPath}/execute`, { method: "POST" });
    }
    receipt = outcome.status;
    if (receipt === "completed") notifyProject();
    const status = await reconcile();
    if (status === "unknown") {
      report("操作结果待核实；不会自动重试。");
      return false;
    }
    return status === "completed" || status === "failed";
  } catch (cause) {
    try {
      let status: string | undefined;
      for (let attempt = 0; attempt < 6; attempt++) {
        if (signal.aborted) return false;
        try {
          status = await reconcile();
          if (status !== "running") break;
        } catch (error) {
          if (attempt === 5) throw error;
        }
        if (attempt < 5)
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
      if (status === "completed" && allow) {
        if (receipt !== "completed") notifyProject();
        return true;
      }
      if (status === "rejected" && !allow) return true;
      if (status === "failed" && allow) return true;
      if (status === "running" || status === "unknown") {
        report("操作结果待核实；不会自动重试。");
        return false;
      }
    } catch {
      report("无法读取审批回执；请恢复连接后重新打开对话查看结果。");
      return false;
    }
    report(cause instanceof Error ? cause.message : String(cause));
    return false;
  } finally {
    activeActionRef.current = null;
  }
}
