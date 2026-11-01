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
  detailRef: MutableRefObject<Detail | null>;
  activeActionRef: MutableRefObject<{
    conversationId: string;
    actionId: string;
  } | null>;
  setDetail: Dispatch<SetStateAction<Detail | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setScriptOutput: Dispatch<SetStateAction<string>>;
};

export async function decideAmadeusApproval({
  allow,
  current,
  contexts,
  session,
  bridge,
  detailRef,
  activeActionRef,
  setDetail,
  setError,
  setScriptOutput,
}: ApprovalOptions) {
  if (!current) return;
  const conversationId = current.conversationId;
  const pathParams = current.arguments.path_params;
  const projectId =
    current.arguments.project_id ??
    (pathParams && typeof pathParams === "object" && "project_id" in pathParams
      ? pathParams.project_id
      : undefined);
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
  try {
    if (current.status === "pending")
      await fetchApiJson(
        `/v1/amadeus/conversations/${conversationId}/actions/${current.id}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            arguments_sha256: current.arguments_sha256,
            approve: allow,
          }),
        },
      );
    if (!allow) {
      const snapshot = await fetchApiJson<Detail>(
        `/v1/amadeus/conversations/${conversationId}`,
      );
      if (detailRef.current?.conversation.id === conversationId)
        setDetail(snapshot);
      return true;
    }
    activeActionRef.current = { conversationId, actionId: current.id };
    let outcome: { status: string; result?: Record<string, unknown> };
    if (current.tool_name === "run_script") {
      const response = await requestApi(
        `/v1/amadeus/conversations/${conversationId}/actions/${current.id}/execute/stream`,
        { method: "POST" },
      );
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
          if (event.type === "output")
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
      }>(
        `/v1/amadeus/conversations/${conversationId}/actions/${current.id}/execute`,
        { method: "POST" },
      );
    }
    if (
      outcome.status === "completed" &&
      current.tool_name === "video_timeline_batch"
    )
      await bridge.publishAmadeusMutation({
        application: "video-editor",
        projectId,
        userId: session.me.user.id,
        accountId: session.me.user.id,
      });
    if (
      outcome.status === "completed" &&
      current.tool_name.startsWith("fpl_operation:")
    )
      await bridge.publishAmadeusMutation({
        application: "*",
        projectId,
        userId: session.me.user.id,
        accountId: session.me.user.id,
      });
    const snapshot = await fetchApiJson<Detail>(
      `/v1/amadeus/conversations/${conversationId}`,
    );
    if (detailRef.current?.conversation.id === conversationId)
      setDetail(snapshot);
    if (outcome.status === "unknown") {
      setError("操作结果待核实；不会自动重试。");
      return false;
    }
    return true;
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : String(cause));
    return false;
  } finally {
    activeActionRef.current = null;
  }
}
