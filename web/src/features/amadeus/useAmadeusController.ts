import { importConversationFile } from "./attachmentImport";
import { mergeReferences, referenceLimit } from "./elementReferences";
import { getAgents, type Agent as AgentOption } from "@features/code-agents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchApiJson } from "@platform/api/client";
import { useAmadeusBridge } from "./PageContext";
import type { AccountSessionContext } from "@features/accounts";
import { decideAmadeusApproval } from "./approval";
import { submitAmadeusAnswer } from "./answerQuestion";
import { conversationActions } from "./conversationActions";
import { useAmadeusData } from "./useAmadeusData";
import { groupConversations } from "./conversationGroups";
import { selectedProjectContexts } from "./projectScope";
import { useProjectSelection } from "./useProjectSelection";
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
  type FilePreview,
  type ModelOption,
  type NamedOption,
  type Reference,
  type Run,
  type RunDetail,
  type SavedQuestion,
  type WorkFile,
} from "./protocol";

export function useAmadeusController(
  session: AccountSessionContext,
  initialConversationId?: string,
  standalone = false,
) {
  const bridge = useAmadeusBridge();
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
  const [modelId, setModelId] = useState("default");
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [modelVariant, setModelVariant] = useState("");
  const [harnessEffort, setHarnessEffort] = useState("");
  const [fast, setFast] = useState(false);
  const [harnessCatalog, setHarnessCatalog] = useState<{
    model: string;
    options?: NamedOption[];
  } | null>(null);
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
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const submittingRef = useRef(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [workFiles, setWorkFiles] = useState<WorkFile[]>([]);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const filePreviewRequestRef = useRef(0);
  const [scriptAvailable, setScriptAvailable] = useState(false);
  const [registeredOperations, setRegisteredOperations] = useState(0);
  const [previewReference, setPreviewReference] = useState<Reference | null>(
    null,
  );
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
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

  const {
    refreshList,
    open,
    captureSelection,
    adopt,
    selectionPending,
    clearSelection,
  } = useAmadeusData({
    session,
    initialConversationId,
    standalone,
    draft,
    references,
    setDraft,
    bridge,
    detail,
    detailRef,
    contextRef,
    avatarTimerRef,
    activeActionRef,
    loaded,
    loadedConversationId,
    setConversations,
    setDetail,
    setRuns,
    setActiveRun,
    setBusy,
    setReferences,
    setFilesOpen,
    setWorkFiles,
    setError,
    setContexts,
    setAvatarState,
    setLoaded,
    setLoadedConversationId,
  });

  const owner = session.me.user.id;
  const scopedContexts = contexts.filter(
    (item) => item.userId === owner && item.accountId === owner,
  );
  const conversationId = detail?.conversation.id;
  const { projects, setProjects } = useProjectSelection({
    owner,
    conversationId,
    pageContexts: scopedContexts,
    lastRunContexts:
      runs.filter(({ run }) => run.conversation_id === conversationId).at(-1)
        ?.run.context ?? [],
    standalone,
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
  }, [session.me.user.id, refreshCapabilities]);
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
  }, [session.me.user.id]);
  const selectedAgent = agents.find((item) => item.id === agentId);
  const models: ModelOption[] = [
    { id: "default", label: "CLI 默认模型" },
    ...(selectedAgent?.models || []),
  ];
  if (!models.some((item) => item.id === modelId))
    models.push({ id: modelId, label: `${modelId} · 上次使用` });
  const selectedModel = models.find((item) => item.id === modelId);
  const reasoningEfforts = selectedModel?.reasoning_efforts ?? [];
  const modelVariants = selectedModel?.variants ?? [];
  const fastAvailable = selectedModel?.fast_available === true;
  const harnessModel =
    agentId === "dsh" && modelId !== "default" ? modelId : null;
  const currentHarnessCatalog =
    harnessCatalog?.model === harnessModel ? harnessCatalog : null;
  const harnessEfforts = currentHarnessCatalog?.options ?? [];
  const harnessCatalogStatus = !harnessModel
    ? null
    : !currentHarnessCatalog
      ? "loading"
      : currentHarnessCatalog.options
        ? "available"
        : "unavailable";
  useEffect(() => {
    setHarnessCatalog(null);
    if (!harnessModel) return;
    let latestRequest: AbortController | undefined;
    const refresh = () => {
      latestRequest?.abort();
      const request = new AbortController();
      latestRequest = request;
      void fetchApiJson<{ items: AgentOption[] }>(
        `/v1/code-agents?harness_model=${encodeURIComponent(harnessModel)}`,
        { signal: request.signal },
      )
        .then(({ items }) => {
          if (request.signal.aborted) return;
          const harness = items.find((item) => item.id === "dsh");
          setHarnessCatalog({
            model: harnessModel,
            options:
              harness?.harness_options_model === harnessModel
                ? (harness.harness_efforts ?? [])
                : undefined,
          });
        })
        .catch(() => {
          if (!request.signal.aborted)
            setHarnessCatalog({ model: harnessModel });
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      latestRequest?.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [harnessModel, session.me.user.id]);
  const effectiveReasoningEffort = reasoningEfforts.includes(reasoningEffort)
    ? reasoningEffort
    : "";
  const selectedConversationRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const conversation = detail?.conversation;
    if (!conversation || selectedConversationRef.current === conversation.id)
      return;
    selectedConversationRef.current = conversation.id;
    if (conversation.agent_id) {
      setAgentId(conversation.agent_id);
    }
    const latest = runs
      .filter((item) => item.run.conversation_id === conversation.id)
      .at(-1)?.run;
    setModelId(latest?.agent_model || "default");
    setReasoningEffort(latest?.reasoning_effort || "");
    setModelVariant(latest?.model_variant || "");
    setHarnessEffort(latest?.harness_effort || "");
    setFast(latest?.service_tier === "fast");
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
    pinMessage,
    forkMessage,
    rename,
    remove,
    showFiles,
    previewFile,
    downloadFile,
  } = conversationActions({
    detailRef,
    busy,
    filesOpen,
    refreshList,
    open,
    clearSelection,
    setDetail,
    setError,
    setRenameItem,
    setDeleteItem,
    setFilesOpen,
    setWorkFiles,
    filePreviewRequestRef,
    setFilePreview,
  });

  const importAttachments = async (files: File[]) => {
    if (!files.length || busy || importingRef.current || submittingRef.current)
      return;
    if (selectionPending()) {
      setError("正在打开对话，请稍后重新导入附件。");
      return;
    }
    let available = referenceLimit - references.length;
    if (available <= 0) {
      setError(`每轮最多引用 ${referenceLimit} 项。`);
      return;
    }
    importingRef.current = true;
    setImporting(true);
    setError("");
    let isCurrent = captureSelection();
    const failures: string[] = [];
    try {
      let current = detailRef.current;
      for (const file of files) {
        if (!isCurrent()) break;
        if (file.size > 50 * 1024 * 1024) {
          failures.push(`${file.name}：单个文件不能超过 50 MiB`);
          continue;
        }
        if (available <= 0) {
          failures.push(`${file.name}：已达到引用上限`);
          continue;
        }
        try {
          if (!current) {
            const created = await fetchApiJson<Conversation>(
              "/v1/amadeus/conversations",
              { method: "POST" },
            );
            if (!isCurrent()) break;
            selectedConversationRef.current = created.id;
            current = { conversation: created, messages: [], actions: [] };
            adopt(current);
            isCurrent = captureSelection();
            void refreshList().catch(() => {});
          }
          const reference = await importConversationFile(
            current.conversation.id,
            file,
          );
          if (!isCurrent()) break;
          setReferences((previous) => mergeReferences(previous, [reference]));
          available--;
        } catch (cause) {
          failures.push(
            `${file.name}：${cause instanceof Error ? cause.message : String(cause)}`,
          );
          if (!current) break;
        }
      }
      if (current && filesOpen && isCurrent()) {
        try {
          const listing = await fetchApiJson<{ items: WorkFile[] }>(
            `/v1/amadeus/conversations/${current.conversation.id}/files`,
          );
          if (isCurrent()) setWorkFiles(listing.items);
        } catch {
          if (isCurrent())
            failures.push("会话文件列表读取失败，请重新打开列表。");
        }
      }
      if (failures.length && isCurrent()) setError(failures.join("；"));
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

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
    if (
      !prompt ||
      busy ||
      importingRef.current ||
      submittingRef.current ||
      selectionPending()
    )
      return;
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
    if (detailRef.current?.conversation.executor_kind === "legacy-pi") {
      setError("旧对话只读；请复制需要的上下文并新建 Code Agent 对话");
      return;
    }
    submittingRef.current = true;
    const isCurrent = captureSelection();
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
        if (!isCurrent()) {
          setBusy(false);
          return;
        }
        // A first send already has a local model selection. History restoration
        // applies when opening a saved conversation, not when allocating its ID.
        selectedConversationRef.current = created.id;
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
      if (isSubmittingToSelection()) {
        setDetail(current);
        detailRef.current = current;
      }
      const value = await fetchApiJson<RunDetail>(
        `/v1/amadeus/conversations/${current.conversation.id}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: agentId,
            agent_model: modelId === "default" ? "" : modelId,
            reasoning_effort: effectiveReasoningEffort || undefined,
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
      if (fast) setFast(false);
      setActiveRun(value.run);
      activeRunRef.current = value.run;
      if (isSubmittingToSelection())
        setRuns((previous) => [...previous, value]);
      if (!options && isSubmittingToSelection()) {
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
    } finally {
      submittingRef.current = false;
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
    const history = await open(id);
    const source = history?.find((item) => item.run.id === sourceRunId)?.run;
    const resolvedInteraction =
      source &&
      ["waiting_approval", "waiting_question"].includes(source.status);
    if (
      resolvedInteraction &&
      history?.some((item) => item.run.source_run_id === sourceRunId)
    )
      return;
    if (detailRef.current?.conversation.id === id)
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
    if (detailRef.current?.conversation.id !== current.conversationId) return;
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
    if (
      handled &&
      detailRef.current?.conversation.id === current.conversationId
    )
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
    if (detailRef.current?.conversation.id !== id) return;
    await continueRun(
      question.run_id,
      runs.find((item) => item.run.id === question.run_id)?.run.mode || "agent",
      "用户已经回答提问。根据已保存的答案继续。",
    );
  };

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
    importing,
    saving,
    activeRun,
    error,
    setError,
    agents,
    agentId,
    setAgentId,
    models,
    modelCatalog: selectedAgent?.model_catalog,
    modelId,
    setModelId: (value: string) => {
      setModelId(value);
      setReasoningEffort("");
      setModelVariant("");
      setHarnessEffort("");
      setFast(false);
    },
    modelVariants,
    modelVariant,
    setModelVariant,
    harnessEfforts,
    harnessEffort,
    harnessCatalogStatus,
    setHarnessEffort,
    fastAvailable,
    fast,
    setFast,
    reasoningEfforts,
    reasoningEffort: effectiveReasoningEffort,
    setReasoningEffort,
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
    filesOpen,
    setFilesOpen,
    workFiles,
    filePreview:
      filePreview?.conversationId === conversationId ? filePreview : null,
    closeFilePreview: () => {
      filePreviewRequestRef.current += 1;
      setFilePreview(null);
    },
    scriptAvailable,
    registeredOperations,
    previewReference,
    setPreviewReference,
    avatarState,
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
    pinMessage,
    forkMessage,
    rename,
    remove,
    importAttachments,
    showFiles,
    previewFile,
    downloadFile,
    send,
    startFromHistory,
    scopedContexts,
    projects,
    setProjects,
    groups,
  };
}
