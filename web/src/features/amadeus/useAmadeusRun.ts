import { useEffect, useRef, useState } from "react";
import { fetchApiJson } from "@platform/api/client";
import type { useAmadeusData } from "./useAmadeusData";
import type { useAmadeusCapabilities } from "./useAmadeusCapabilities";
import { selectedProjectContexts, type ProjectReference } from "./projectScope";
import {
  conversationConflict,
  CONVERSATION_CONFLICT_MESSAGE,
} from "./revisionConflict";
import type {
  AvatarState,
  Context,
  Conversation,
  Detail,
  Run,
  RunDetail,
} from "./protocol";

export function useAmadeusRun({
  owner,
  conversations,
  capabilities,
  projects,
  scopedContexts,
  isImporting,
  setError,
  showAvatarState,
}: {
  owner: string;
  conversations: Pick<
    ReturnType<typeof useAmadeusData>,
    | "getDetail"
    | "open"
    | "openRecoveredRun"
    | "refreshList"
    | "acceptRun"
    | "updateDetail"
    | "draft"
    | "references"
    | "loaded"
    | "captureSelection"
    | "selectionPending"
    | "adopt"
    | "clearDraft"
  >;
  capabilities: Pick<
    ReturnType<typeof useAmadeusCapabilities>,
    | "agents"
    | "agentId"
    | "modelId"
    | "modelVariant"
    | "modelVariants"
    | "harnessEffort"
    | "harnessEfforts"
    | "harnessCatalogStatus"
    | "fast"
    | "fastAvailable"
    | "setFast"
    | "reasoningEffort"
    | "keepModelSelection"
  >;
  projects: ProjectReference[];
  scopedContexts: Context[];
  isImporting: () => boolean;
  setError: (message: string) => void;
  showAvatarState: (state: AvatarState, resetAfter?: number) => void;
}) {
  const [mode, setMode] = useState<"agent" | "plan">("agent");
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const submissionVersion = useRef(0);
  const lifetime = useRef<AbortController | undefined>(undefined);
  const activeRunRef = useRef<Run | null>(null);
  const busy = submitting || activeRun !== null;
  const isBusy = () => submittingRef.current || activeRunRef.current !== null;
  const {
    getDetail,
    open,
    openRecoveredRun,
    refreshList,
    acceptRun,
    updateDetail,
    draft,
    references,
    loaded,
    captureSelection,
    selectionPending,
    adopt,
    clearDraft,
  } = conversations;
  const {
    agents,
    agentId,
    modelId,
    modelVariant,
    modelVariants,
    harnessEffort,
    harnessEfforts,
    harnessCatalogStatus,
    fast,
    fastAvailable,
    setFast,
    reasoningEffort,
    keepModelSelection,
  } = capabilities;

  useEffect(() => {
    const request = new AbortController();
    lifetime.current = request;
    activeRunRef.current = null;
    setActiveRun(null);
    submittingRef.current = false;
    setSubmitting(false);
    const isCurrent = captureSelection();
    const version = submissionVersion.current;
    void fetchApiJson<RunDetail | null>("/v1/amadeus/runs/active", {
      signal: request.signal,
    })
      .then(async (running) => {
        if (
          request.signal.aborted ||
          !running ||
          version !== submissionVersion.current
        )
          return;
        activeRunRef.current = running.run;
        setActiveRun(running.run);
        await openRecoveredRun(running.run.conversation_id, isCurrent);
      })
      .catch((cause) => {
        if (!request.signal.aborted) setError(String(cause));
      });
    return () => request.abort();
  }, [owner, captureSelection, openRecoveredRun, setError]);

  const stop = () => {
    const run = activeRunRef.current;
    if (!run) return;
    const scope = lifetime.current;
    void fetchApiJson(
      `/v1/amadeus/conversations/${run.conversation_id}/runs/${run.id}/cancel`,
      { method: "POST" },
    ).catch((cause) => {
      if (!scope?.signal.aborted) setError(String(cause));
    });
  };

  useEffect(() => {
    if (!activeRun) return;
    const request = new AbortController();
    let timer: number | undefined;
    const run = activeRun;
    const poll = async () => {
      try {
        const value = await fetchApiJson<RunDetail>(
          `/v1/amadeus/conversations/${run.conversation_id}/runs/${run.id}`,
          { signal: request.signal },
        );
        if (request.signal.aborted) return;
        acceptRun(value);
        if (!["running", "cancelling"].includes(value.run.status)) {
          setActiveRun(null);
          activeRunRef.current = null;
          showAvatarState(
            value.run.status === "completed" ? "success" : "paused",
            2200,
          );
          if (value.run.error_message) setError(value.run.error_message);
          if (getDetail()?.conversation.id === run.conversation_id)
            await open(run.conversation_id);
          await refreshList();
          return;
        }
      } catch (cause) {
        if (!request.signal.aborted)
          setError(`连接暂时中断，正在重新读取任务状态：${String(cause)}`);
      }
      if (!request.signal.aborted)
        timer = window.setTimeout(() => void poll(), 1200);
    };
    void poll();
    return () => {
      request.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [
    activeRun,
    acceptRun,
    getDetail,
    open,
    refreshList,
    setError,
    showAvatarState,
  ]);

  const send = async (options?: {
    prompt: string;
    sourceRunId: string;
    mode: "agent" | "plan";
    feedback?: string;
  }) => {
    const prompt = options?.prompt || draft.trim();
    if (!prompt || isBusy() || isImporting() || selectionPending()) return;
    if (!agents.find((a) => a.id === agentId)?.available) {
      setError("请先在 AI 能力 → 模型与智能体 → 编程智能体 配置并授权此 Agent");
      return;
    }
    if (
      (modelVariant &&
        !modelVariants.some((option) => option.id === modelVariant)) ||
      (harnessEffort &&
        !harnessEfforts.some((option) => option.id === harnessEffort)) ||
      (fast && !fastAvailable)
    ) {
      setError(
        harnessEffort && harnessCatalogStatus === "loading"
          ? "正在读取所选模型的推理档位，请稍后再试"
          : "上次选择的运行选项当前不可用，请重新选择或使用 CLI 默认选项",
      );
      return;
    }
    if (getDetail()?.conversation.executor_kind === "legacy-pi") {
      setError("旧对话只读；请复制需要的上下文并新建 Code Agent 对话");
      return;
    }
    submittingRef.current = true;
    submissionVersion.current++;
    const requestScope = lifetime.current;
    setSubmitting(true);
    const isCurrent = captureSelection();
    setError("");
    showAvatarState("thinking");
    try {
      let current = getDetail();
      if (
        current?.conversation.agent_id &&
        current.conversation.agent_id !== agentId
      ) {
        setError("切换 Agent 请先新建对话");
        return;
      }
      if (!current) {
        const created = await fetchApiJson<Conversation>(
          "/v1/amadeus/conversations",
          { method: "POST" },
        );
        if (!isCurrent()) return;
        // A first send already has a local model selection. History restoration
        // applies when opening a saved conversation, not when allocating its ID.
        keepModelSelection(created.id);
        current = {
          conversation: created,
          messages: [],
          actions: [],
          questions: [],
        };
        adopt(current);
      }
      const isSubmittingToSelection = captureSelection();
      const refs = options
        ? []
        : references.map(({ windowId, ...item }) => ({
            ...item,
            window_id: windowId,
          }));
      if (!options || options.feedback) {
        const snapshot = await fetchApiJson<Detail>(
          `/v1/amadeus/conversations/${current.conversation.id}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expected_revision: current.conversation.revision,
              role: "user",
              content: options?.feedback || prompt,
              references: refs,
            }),
          },
        );
        updateDetail(isSubmittingToSelection, () => snapshot);
        current = snapshot;
      }
      if (requestScope?.signal.aborted) return;
      const value = await fetchApiJson<RunDetail>(
        `/v1/amadeus/conversations/${current.conversation.id}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: agentId,
            agent_model: modelId === "default" ? "" : modelId,
            reasoning_effort: reasoningEffort || undefined,
            model_variant: modelVariant || undefined,
            harness_effort: harnessEffort || undefined,
            service_tier: fast ? "fast" : undefined,
            mode: options?.mode || mode,
            source_run_id: options?.sourceRunId,
            context: selectedProjectContexts(
              scopedContexts,
              projects,
              owner,
            ).map((context) => {
              const visibleContext = { ...context };
              delete visibleContext.selection;
              return visibleContext;
            }),
            references: refs,
            capabilities: loaded,
          }),
        },
      );
      if (requestScope?.signal.aborted) return;
      if (fast) setFast(false);
      setActiveRun(value.run);
      activeRunRef.current = value.run;
      if (isSubmittingToSelection()) acceptRun(value);
      if (!options) clearDraft(isSubmittingToSelection);
      await refreshList();
    } catch (cause) {
      const conflict = conversationConflict(cause);
      if (!requestScope?.signal.aborted) {
        setError(conflict ? CONVERSATION_CONFLICT_MESSAGE : String(cause));
        showAvatarState("error", 3200);
      }
      if (options?.feedback) throw cause;
    } finally {
      if (!requestScope?.signal.aborted) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  return { mode, setMode, activeRun, busy, isBusy, send, stop };
}
