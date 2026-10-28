import { getAgents, type Agent as AgentOption } from "@features/code-agents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchApiJson } from "@platform/api/client";
import type { DesktopBridge } from "@platform/desktop";
import type { AccountSessionContext } from "@features/accounts";
import { decideAmadeusApproval } from "./approval";
import { submitAmadeusAnswer } from "./answerQuestion";
import { conversationActions } from "./conversationActions";
import { useAmadeusData } from "./useAmadeusData";
import { groupConversations } from "./conversationGroups";
import {
  conversationConflict,
  CONVERSATION_CONFLICT_MESSAGE,
} from "./revisionConflict";
import {
  type Approval,
  type AvatarState,
  type Capability,
  type Context,
  type Conversation,
  type Detail,
  type ModelOption,
  type Reference,
  type Run,
  type RunDetail,
  type SavedQuestion,
  type WorkFile,
} from "./protocol";

export function useAmadeusController(session: AccountSessionContext) {
  const bridge = window.futurePropsDesktop as Required<DesktopBridge>;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [contexts, setContexts] = useState<Context[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"agent" | "plan">("agent");
  const [runs, setRuns] = useState<RunDetail[]>([]);
  const [busy, setBusy] = useState(false);
  const saving = false;
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelId, setModelId] = useState("default");
  const [agentId, setAgentId] = useState("codex");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [toolSteps, setToolSteps] = useState<
    Array<{ name: string; status: string }>
  >([]);
  const [scriptOutput, setScriptOutput] = useState("");
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [toolApis, setToolApis] = useState<Capability[]>([]);
  const [mcpServers, setMcpServers] = useState<Capability[]>([]);
  const [skills, setSkills] = useState<Capability[]>([]);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [loadedConversationId, setLoadedConversationId] = useState<
    string | null
  >(null);
  const [renameItem, setRenameItem] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteItem, setDeleteItem] = useState<Conversation | null>(null);
  const [attachments, setAttachments] = useState<
    Array<{ name: string; bytes: number }>
  >([]);
  const [filesOpen, setFilesOpen] = useState(false);
  const [workFiles, setWorkFiles] = useState<WorkFile[]>([]);
  const [filePreview, setFilePreview] = useState<{
    name: string;
    text: string;
  } | null>(null);
  const [scriptAvailable, setScriptAvailable] = useState(false);
  const [registeredOperations, setRegisteredOperations] = useState(0);
  const [previewReference, setPreviewReference] = useState<Reference | null>(
    null,
  );
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeActionRef = useRef<{
    conversationId: string;
    actionId: string;
  } | null>(null);
  const activeRunRef = useRef<Run | null>(null);
  const avatarTimerRef = useRef<number | undefined>(undefined);
  const detailRef = useRef<Detail | null>(null);
  const contextRef = useRef<Context[]>([]);
  detailRef.current = detail;
  contextRef.current = contexts;
  activeRunRef.current = activeRun;

  const showAvatarState = useCallback(
    (state: AvatarState, resetAfter?: number) => {
      if (avatarTimerRef.current) window.clearTimeout(avatarTimerRef.current);
      setAvatarState(state);
      if (resetAfter) {
        avatarTimerRef.current = window.setTimeout(() => {
          setAvatarState("idle");
          avatarTimerRef.current = undefined;
        }, resetAfter);
      }
    },
    [],
  );

  const { refreshList, open } = useAmadeusData({
    session,
    bridge,
    detail,
    detailRef,
    contextRef,
    avatarTimerRef,
    loaded,
    loadedConversationId,
    setConversations,
    setDetail,
    setRuns,
    setActiveRun,
    setBusy,
    setReferences,
    setAttachments,
    setFilesOpen,
    setWorkFiles,
    setError,
    setModels,
    setModelId,
    setContexts,
    setAlwaysOnTop,
    setAvatarState,
    setLoaded,
    setLoadedConversationId,
  });

  const refreshCapabilities = useCallback(async () => {
    try {
      const [apis, mcps, skillList] = await Promise.all([
        fetchApiJson<{ items: Capability[] }>("/v1/integrations/tool-apis"),
        fetchApiJson<{ items: Capability[] }>("/v1/integrations/mcp"),
        fetchApiJson<{ items: Capability[] }>("/v1/integrations/skills"),
      ]);
      setToolApis(apis.items);
      setMcpServers(mcps.items);
      setSkills(skillList.items);
      setScriptAvailable(false);
      const business = await fetchApiJson<{ items: unknown[] }>(
        "/v1/amadeus/operations",
      );
      setRegisteredOperations(business.items.length);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => {
    void refreshCapabilities();
  }, [session.me.workspace.id, refreshCapabilities]);
  const openCapabilities = async () => {
    setCapabilitiesOpen(!capabilitiesOpen);
    if (!capabilitiesOpen) await refreshCapabilities();
  };
  const stop = () => {
    const run = activeRunRef.current;
    if (!run) return;
    void fetchApiJson(
      `/v1/amadeus/conversations/${run.conversation_id}/runs/${run.id}/cancel`,
      { method: "POST" },
    ).catch((cause) => setError(String(cause)));
  };

  useEffect(() => {
    let alive = true;
    setAgents([]);
    const refresh = () => {
      void getAgents()
        .then((value) => {
          if (alive) setAgents(value.items);
        })
        .catch((cause) => {
          if (alive) setError(String(cause));
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
    };
  }, [session.me.user.id, session.me.workspace.id]);
  useEffect(() => {
    const options = [
      { id: "default", label: "CLI 默认模型" },
      ...(agents.find((a) => a.id === agentId)?.models || []),
    ];
    setModels(options);
    setModelId((previous) =>
      options.some((item) => item.id === previous) ? previous : "default",
    );
  }, [agentId, agents]);
  const selectedConversationRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const conversation = detail?.conversation;
    if (!conversation || selectedConversationRef.current === conversation.id)
      return;
    selectedConversationRef.current = conversation.id;
    if (conversation.agent_id) {
      setAgentId(conversation.agent_id);
      setModelId(runs.at(-1)?.run.agent_model || "default");
    }
  }, [detail?.conversation, runs]);

  useEffect(() => {
    if (!activeRun) return;
    let alive = true;
    let timer: number | undefined;
    const run = activeRun;
    const poll = async () => {
      try {
        const value = await fetchApiJson<RunDetail>(
          `/v1/amadeus/conversations/${run.conversation_id}/runs/${run.id}`,
        );
        if (!alive) return;
        if (detailRef.current?.conversation.id === run.conversation_id) {
          setRuns((previous) => [
            ...previous.filter((item) => item.run.id !== run.id),
            value,
          ]);
          setToolSteps(
            value.events
              .filter((event) => event.kind === "tool_call")
              .map((event) => ({
                name: String(event.payload.tool_name || "工具"),
                status: "running",
              })),
          );
          setDetail((previous) =>
            previous
              ? {
                  ...previous,
                  messages: [
                    ...previous.messages.filter(
                      (message) => message.id !== `stream:${run.id}`,
                    ),
                    ...(value.run.partial_text
                      ? [
                          {
                            id: `stream:${run.id}`,
                            role: "assistant",
                            content: value.run.partial_text,
                            references: [],
                            created_at: new Date().toISOString(),
                            run_id: run.id,
                          },
                        ]
                      : []),
                  ],
                }
              : previous,
          );
        }
        if (!["running", "cancelling"].includes(value.run.status)) {
          setActiveRun(null);
          activeRunRef.current = null;
          setBusy(false);
          showAvatarState(
            value.run.status === "completed" ? "success" : "paused",
            2200,
          );
          if (value.run.error_message) setError(value.run.error_message);
          if (detailRef.current?.conversation.id === run.conversation_id)
            await open(run.conversation_id);
          await refreshList();
          return;
        }
      } catch (cause) {
        if (alive)
          setError(`连接暂时中断，正在重新读取任务状态：${String(cause)}`);
      }
      if (alive) timer = window.setTimeout(() => void poll(), 1200);
    };
    void poll();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeRun, detailRef, open, refreshList, showAvatarState]);

  const {
    create,
    rename,
    remove,
    importAttachment,
    showFiles,
    previewFile,
    downloadFile,
  } = conversationActions({
    detailRef,
    busy,
    filesOpen,
    refreshList,
    open,
    setDetail,
    setError,
    setRenameItem,
    setDeleteItem,
    setAttachments,
    setReferences,
    setFilesOpen,
    setWorkFiles,
    setFilePreview,
  });

  const startFromHistory = async () => {
    const previous = detailRef.current;
    const context =
      previous?.messages
        .slice(-8)
        .map((message) => `${message.role}: ${message.content.slice(0, 3000)}`)
        .join("\n\n") || "";
    await create();
    setDraft(
      `以下是我选择带入的历史参考，请先核对当前项目状态，再根据我的新要求继续。\n\n${context}\n\n新要求：`,
    );
  };

  const send = async (options?: {
    prompt: string;
    sourceRunId: string;
    mode: "agent" | "plan";
    feedback?: string;
  }) => {
    const prompt = options?.prompt || draft.trim();
    if (!prompt || busy) return;
    if (!agents.find((a) => a.id === agentId)?.available) {
      setError("请先在 AI 能力 → 模型与智能体 → 编程智能体 配置并授权此 Agent");
      return;
    }
    if (detailRef.current?.conversation.executor_kind === "legacy-pi") {
      setError("旧对话只读；请复制需要的上下文并新建 Code Agent 对话");
      return;
    }
    setBusy(true);
    setError("");
    showAvatarState("thinking");
    try {
      let current = detailRef.current;
      if (
        current?.conversation.agent_id &&
        current.conversation.agent_id !== agentId
      ) {
        setError("切换 Agent 请先新建对话");
        setBusy(false);
        return;
      }
      if (!current) {
        const created = await fetchApiJson<Conversation>(
          "/v1/amadeus/conversations",
          { method: "POST" },
        );
        current = {
          conversation: created,
          messages: [],
          actions: [],
          questions: [],
        };
      }
      const refs = options
        ? []
        : references.map(({ windowId, ...item }) => ({
            ...item,
            window_id: windowId,
          }));
      if (!options || options.feedback)
        current = await fetchApiJson<Detail>(
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
      setDetail(current);
      detailRef.current = current;
      const value = await fetchApiJson<RunDetail>(
        `/v1/amadeus/conversations/${current.conversation.id}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: agentId,
            agent_model: modelId === "default" ? "" : modelId,
            mode: options?.mode || mode,
            source_run_id: options?.sourceRunId,
            context: contexts.filter(
              (item) =>
                item.userId === session.me.user.id &&
                item.workspaceId === session.me.workspace.id,
            ),
            references: refs,
            capabilities: loaded,
          }),
        },
      );
      setActiveRun(value.run);
      activeRunRef.current = value.run;
      setRuns((previous) => [...previous, value]);
      if (!options) {
        setDraft("");
        setReferences([]);
      }
      await refreshList();
    } catch (cause) {
      const conflict = conversationConflict(cause);
      setError(conflict ? CONVERSATION_CONFLICT_MESSAGE : String(cause));
      setBusy(false);
      showAvatarState("error", 3200);
      if (options?.feedback) throw cause;
    }
  };

  const continueRun = async (
    sourceRunId: string,
    nextMode: "agent" | "plan",
    prompt: string,
    feedback?: string,
  ) => {
    const id = detailRef.current?.conversation.id;
    if (!id || busy) return;
    setMode(nextMode);
    await open(id);
    await send({ sourceRunId, mode: nextMode, prompt, feedback });
  };

  const reviseArtifact = async (
    sourceRunId: string,
    kind: "plan" | "draft",
    content: string,
    note: string,
  ) => {
    const label = kind === "plan" ? "计划" : "草稿";
    const feedback = `请根据我修订的${label}重新思考并交付新版本。\n\n[我的修订]\n${content}\n\n[补充说明]\n${note || "无"}`;
    if (feedback.length > 90_000)
      throw new Error("修订内容过长，请缩短后重试。");
    await continueRun(
      sourceRunId,
      kind === "plan" ? "plan" : "agent",
      feedback,
      feedback,
    );
  };

  const reviseApproval = async (
    actionId: string,
    arguments_: Record<string, unknown>,
    note: string,
  ) => {
    const saved = detailRef.current?.actions.find(
      (item) => item.id === actionId,
    );
    if (!saved || !saved.run_id || saved.status !== "pending" || busy)
      throw new Error("这份审批已不可修订，请刷新对话。");
    const feedback = `旧提案已撤回。请重新读取目标及最新版本，参考我修订的完整参数重新拟案；不要直接执行。\n\n[参数草案]\n${JSON.stringify(arguments_, null, 2)}\n\n[补充说明]\n${note || "无"}`;
    if (feedback.length > 90_000)
      throw new Error("修订参数过长，请缩短后重试。");
    const current: Approval = {
      id: saved.id,
      tool_name: saved.tool_name,
      arguments: saved.arguments,
      arguments_sha256: saved.arguments_sha256,
      status: saved.status,
      conversationId: detailRef.current!.conversation.id,
      runId: saved.run_id,
    };
    const withdrawn = await decideAmadeusApproval({
      allow: false,
      current,
      contexts,
      session,
      bridge,
      detailRef,
      activeActionRef,
      setDetail,
      setError,
      setScriptOutput,
    });
    if (!withdrawn) throw new Error("撤回旧审批失败");
    await continueRun(saved.run_id, "agent", feedback, feedback);
  };

  const decideApproval = async (actionId: string, allow: boolean) => {
    const saved = detailRef.current?.actions.find(
      (item) => item.id === actionId,
    );
    if (!saved || !saved.run_id) return;
    const current: Approval = {
      id: saved.id,
      tool_name: saved.tool_name,
      arguments: saved.arguments,
      arguments_sha256: saved.arguments_sha256,
      status: saved.status,
      conversationId: detailRef.current!.conversation.id,
      runId: saved.run_id,
    };
    const handled = await decideAmadeusApproval({
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
    });
    await open(current.conversationId);
    if (handled)
      await continueRun(
        current.runId,
        "agent",
        allow
          ? "根据刚才已批准的工具结果继续，先核对当前项目状态。"
          : "刚才的操作被拒绝。继续说明可行的下一步，不再执行该操作。",
      );
  };

  const answerQuestion = async (
    question: SavedQuestion,
    answer: string,
    note: string,
  ) => {
    const id = detailRef.current?.conversation.id;
    if (!id || busy) return;
    await submitAmadeusAnswer(id, question, answer, note);
    await continueRun(
      question.run_id,
      runs.find((item) => item.run.id === question.run_id)?.run.mode || "agent",
      "用户已经回答提问。根据已保存的答案继续。",
    );
  };

  const scopedContexts = contexts.filter(
    (item) =>
      item.userId === session.me.user.id &&
      item.workspaceId === session.me.workspace.id,
  );
  const groups = useMemo(
    () => groupConversations(conversations, search, renameItem?.id),
    [conversations, search, renameItem?.id],
  );

  return {
    bridge,
    detail,
    historyOpen,
    setHistoryOpen,
    search,
    setSearch,
    references,
    setReferences,
    draft,
    setDraft,
    mode,
    setMode,
    runs,
    busy,
    saving,
    activeRun,
    error,
    setError,
    agents,
    agentId,
    setAgentId,
    models,
    modelId,
    setModelId,
    toolSteps,
    scriptOutput,
    capabilitiesOpen,
    setCapabilitiesOpen,
    toolApis,
    mcpServers,
    skills,
    loaded,
    setLoaded,
    renameItem,
    setRenameItem,
    renameTitle,
    setRenameTitle,
    deleteItem,
    setDeleteItem,
    attachments,
    filesOpen,
    setFilesOpen,
    workFiles,
    filePreview,
    setFilePreview,
    scriptAvailable,
    registeredOperations,
    previewReference,
    setPreviewReference,
    avatarState,
    alwaysOnTop,
    setAlwaysOnTop,
    fileInputRef,
    showAvatarState,
    open,
    openCapabilities,
    decideApproval,
    reviseApproval,
    reviseArtifact,
    answerQuestion,
    continueRun,
    stop,
    create,
    rename,
    remove,
    importAttachment,
    showFiles,
    previewFile,
    downloadFile,
    send,
    startFromHistory,
    scopedContexts,
    groups,
  };
}
