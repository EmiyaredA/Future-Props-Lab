import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchApiJson, requestApi } from "@platform/api/client";
import type { DesktopBridge } from "@platform/desktop";
import type { AccountSessionContext } from "@features/accounts";
import { decideAmadeusApproval } from "./approval";
import { submitAmadeusAnswer } from "./answerQuestion";
import { configuredCapabilities } from "./configuredCapabilities";
import { conversationActions } from "./conversationActions";
import { useAmadeusData } from "./useAmadeusData";
import { groupConversations } from "./conversationGroups";
import { formatAmadeusPrompt } from "./formatPrompt";
import { buildAgentHistory } from "./history";
import { createRunEventRecorder } from "./runEvents";
import {
  conversationConflict,
  CONVERSATION_CONFLICT_MESSAGE,
} from "./revisionConflict";
import { streamTurn } from "./streamTurn";
import { encodeVideoContactSheet } from "./videoReference";
import {
  safeReadPath,
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
  type WorkerEvent,
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
  const [saving, setSaving] = useState(false);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelId, setModelId] = useState("");
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
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
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
  const workerRef = useRef<Worker | undefined>(undefined);
  const modelAbortRef = useRef<AbortController | undefined>(undefined);
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
    modelAbortRef,
    workerRef,
    activeRunRef,
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
      const script = await fetchApiJson<{ available: boolean }>(
        "/v1/amadeus/script-capability",
      );
      setScriptAvailable(script.available);
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
    showAvatarState("paused", 2200);
    modelAbortRef.current?.abort();
    workerRef.current?.postMessage({ type: "stop" });
    const run = activeRunRef.current;
    if (run)
      void fetchApiJson<RunDetail>(
        `/v1/amadeus/conversations/${run.conversation_id}/runs/${run.id}/cancel`,
        { method: "POST" },
      )
        .then(async () => {
          if (!workerRef.current) {
            await fetchApiJson<RunDetail>(
              `/v1/amadeus/conversations/${run.conversation_id}/runs/${run.id}/finish`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  status: "cancelled",
                  error_message: "任务已由用户停止",
                }),
              },
            );
            setActiveRun(null);
            activeRunRef.current = null;
            setBusy(false);
          }
          if (detailRef.current?.conversation.id === run.conversation_id)
            void open(run.conversation_id);
          setError("任务已停止。执行中的外部操作请检查实际结果。");
        })
        .catch(() => setError("停止请求已发出；请检查操作的最终状态。"));
  };

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

  const send = async (options?: {
    prompt: string;
    sourceRunId: string;
    mode: "agent" | "plan";
    feedback?: string;
  }) => {
    const prompt = options?.prompt || draft.trim();
    if (!prompt || busy || !modelId) {
      if (options?.feedback)
        throw new Error(
          busy ? "Agent 正在运行，请稍后重试。" : "请先选择模型。",
        );
      return;
    }
    if (
      !options &&
      (detailRef.current?.questions?.some(
        (item) => item.status === "pending",
      ) ||
        detailRef.current?.actions.some(
          (item) =>
            item.run_id &&
            ["pending", "approved", "running"].includes(item.status),
        ))
    ) {
      setError("请先处理当前提问或审批。");
      return;
    }
    const runMode = options?.mode || mode;
    const referenceSnapshot = options ? [] : references;
    const contextSnapshot = contexts.filter(
      (item) =>
        item.userId === session.me.user.id &&
        item.workspaceId === session.me.workspace.id,
    );
    setBusy(true);
    showAvatarState("thinking");
    setError("");
    if (!options) setDraft("");
    setToolSteps([]);
    setScriptOutput("");
    let startedRun: Run | null = null;
    let heartbeatTimer: number | undefined;
    try {
      let current = detailRef.current;
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
        setDetail(current);
      }
      const previousRuns = await fetchApiJson<RunDetail[]>(
        `/v1/amadeus/conversations/${current.conversation.id}/runs`,
      );
      const history = buildAgentHistory(
        current.messages,
        previousRuns,
        current.actions,
        current.questions || [],
      );
      const updated =
        options && !options.feedback
          ? current
          : await fetchApiJson<Detail>(
              `/v1/amadeus/conversations/${current.conversation.id}/messages`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  expected_revision: current.conversation.revision,
                  role: "user",
                  content: options?.feedback || prompt,
                  references: options
                    ? []
                    : referenceSnapshot.map(({ windowId, ...item }) => ({
                        ...item,
                        window_id: windowId,
                      })),
                }),
              },
            );
      setDetail(updated);
      detailRef.current = updated;
      if (!options) setReferences([]);
      await refreshList();
      const configured = await configuredCapabilities({
        mode: runMode,
        conversationId: updated.conversation.id,
        loaded,
        toolApis,
        mcpServers,
        skills,
      });
      const runDetail = await fetchApiJson<RunDetail>(
        `/v1/amadeus/conversations/${updated.conversation.id}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model_id: modelId,
            mode: runMode,
            source_run_id: options?.sourceRunId,
            context: contextSnapshot.map((item) => ({
              application: item.application,
              projectId: item.projectId,
              path: item.path,
              unsaved: item.unsaved,
              selection: item.selection,
            })),
            references: referenceSnapshot.map(({ windowId, ...item }) => ({
              ...item,
              window_id: windowId,
            })),
            capabilities: loaded,
          }),
        },
      );
      const run = runDetail.run;
      setRuns((previous) => [...previous, runDetail]);
      startedRun = run;
      setActiveRun(run);
      activeRunRef.current = run;
      heartbeatTimer = window.setInterval(() => {
        void fetchApiJson(
          `/v1/amadeus/conversations/${run.conversation_id}/runs/${run.id}/heartbeat`,
          { method: "POST" },
        ).catch(() => undefined);
      }, 15_000);
      const worker = new Worker(new URL("./agent.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      const conversationId = updated.conversation.id;
      let text = "";
      let partialText = "";
      let pendingDelta = "";
      let deltaTimer: number | undefined;
      const recorder = createRunEventRecorder(conversationId, run.id, (saved) =>
        setRuns((previous) =>
          previous.map((item) =>
            item.run.id === run.id
              ? { ...item, events: [...item.events, saved] }
              : item,
          ),
        ),
      );
      const persistEvent = recorder.append;
      const flushDelta = () => {
        if (deltaTimer) window.clearTimeout(deltaTimer);
        deltaTimer = undefined;
        if (!pendingDelta) return recorder.wait();
        const value = pendingDelta;
        pendingDelta = "";
        return persistEvent("assistant_delta", { text: value });
      };
      const scheduleDelta = () => {
        if (deltaTimer) return;
        deltaTimer = window.setTimeout(() => void flushDelta(), 250);
      };
      const showStream = () => {
        if (detailRef.current?.conversation.id !== conversationId) return;
        const previous = detailRef.current;
        const temporary = {
          id: "streaming",
          role: "assistant",
          content: text + partialText,
          references: [],
          created_at: new Date().toISOString(),
        };
        setDetail({
          ...previous,
          messages: [
            ...previous.messages.filter((item) => item.id !== "streaming"),
            temporary,
          ],
        });
      };
      worker.onmessage = async ({ data }: MessageEvent<WorkerEvent>) => {
        if (activeRunRef.current?.id !== run.id) return;
        try {
          if (data.type === "rpc") {
            let value: unknown;
            if (data.method === "model-turn-stream") {
              value = await streamTurn(
                data.payload,
                data.id,
                worker,
                (controller) => {
                  modelAbortRef.current = controller;
                },
              );
            } else if (data.method === "fpl-read")
              value = await fetchApiJson(safeReadPath(data.payload));
            else if (data.method === "fpl-operations") {
              const requested = data.payload as { resource?: string };
              if (requested.resource && !/^[a-z]+$/.test(requested.resource))
                throw new Error("应用资源名无效");
              value = await fetchApiJson(
                `/v1/amadeus/operations${
                  requested.resource
                    ? `?resource=${encodeURIComponent(requested.resource)}`
                    : ""
                }`,
              );
            } else if (data.method === "fpl-operation-read") {
              const requested = data.payload as {
                operation: string;
                path_params?: Record<string, string>;
                query?: Record<string, unknown>;
              };
              value = await fetchApiJson("/v1/amadeus/operations/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  operation: requested.operation,
                  arguments: {
                    path_params: requested.path_params || {},
                    query: requested.query || {},
                  },
                }),
              });
            } else if (data.method === "list-files")
              value = await fetchApiJson(
                `/v1/amadeus/conversations/${conversationId}/files`,
              );
            else if (data.method === "file-read") {
              const requested = data.payload as { kind: string; name: string };
              const listing = await fetchApiJson<{ items: WorkFile[] }>(
                `/v1/amadeus/conversations/${conversationId}/files`,
              );
              if (
                !listing.items.some(
                  (item) =>
                    item.kind === requested.kind &&
                    item.name === requested.name &&
                    item.bytes <= 1024 * 1024,
                )
              )
                throw new Error("文件不存在或超过 1 MiB；请先列出会话文件");
              const response = await requestApi(
                `/v1/amadeus/conversations/${conversationId}/files/${encodeURIComponent(requested.kind)}/${encodeURIComponent(requested.name)}`,
              );
              value = {
                kind: requested.kind,
                name: requested.name,
                content: await response.text(),
              };
            } else if (data.method === "skill-file-read") {
              const requested = data.payload as {
                skill_id: string;
                version: string;
                path: string;
              };
              if (
                !configured.skills.some(
                  (item) =>
                    item.id === requested.skill_id &&
                    item.version === requested.version,
                ) ||
                requested.path
                  .split("/")
                  .some((part) => !part || part === "." || part === "..")
              )
                throw new Error("只能读取当前会话已加载的 Skill 版本");
              value = await fetchApiJson(
                `/v1/amadeus/conversations/${conversationId}/skills/${encodeURIComponent(requested.skill_id)}/${encodeURIComponent(requested.version)}/files/${requested.path
                  .split("/")
                  .map(encodeURIComponent)
                  .join("/")}`,
              );
            } else if (data.method === "video-reference-read") {
              const requested = data.payload as {
                asset_id: string;
                positions_ms: number[];
              };
              const response = await requestApi(
                `/v1/files/${encodeURIComponent(requested.asset_id)}/frames`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    positions_ms: requested.positions_ms,
                    max_width: 640,
                    output: "grid",
                  }),
                },
              );
              value = await encodeVideoContactSheet(
                await response.blob(),
                requested.positions_ms,
              );
            } else if (data.method === "invoke") {
              const requested = data.payload as {
                tool_call_id?: string;
                tool_name: string;
                arguments: Record<string, unknown>;
              };
              const tool = [...toolApis, ...mcpServers].find((item) =>
                requested.tool_name.includes(item.id),
              );
              const builtInTool = [
                "write_script",
                "run_script",
                "video_timeline_batch",
              ].includes(requested.tool_name);
              const registeredTool =
                requested.tool_name.startsWith("fpl_operation:");
              if (
                !builtInTool &&
                !registeredTool &&
                (!tool ||
                  !loaded.includes(
                    requested.tool_name.startsWith("tool_api:")
                      ? `toolapi:${tool.id}`
                      : `mcp:${tool.id}`,
                  ))
              )
                throw new Error("能力未加载");
              await fetchApiJson(
                `/v1/amadeus/conversations/${conversationId}/actions`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    tool_name: requested.tool_name,
                    run_id: run.id,
                    arguments:
                      builtInTool || registeredTool
                        ? requested.arguments
                        : {
                            input: requested.arguments,
                            revision: tool!.revision,
                          },
                  }),
                },
              );
              await flushDelta();
              await recorder.wait();
              await fetchApiJson<RunDetail>(
                `/v1/amadeus/conversations/${conversationId}/runs/${run.id}/pause-approval`,
                { method: "POST" },
              );
              await open(conversationId);
              setBusy(false);
              if (runMode === "plan") setMode("agent");
              setActiveRun(null);
              activeRunRef.current = null;
              if (heartbeatTimer) window.clearInterval(heartbeatTimer);
              worker.terminate();
              workerRef.current = undefined;
              return;
            } else if (data.method === "ask-user") {
              const requested = data.payload as {
                tool_call_id: string;
                question: string;
                options?: string[];
                allow_text?: boolean;
              };
              await flushDelta();
              await recorder.wait();
              await fetchApiJson<SavedQuestion>(
                `/v1/amadeus/conversations/${conversationId}/runs/${run.id}/question`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    tool_call_id: requested.tool_call_id,
                    prompt: requested.question,
                    options: requested.options || [],
                    allow_text: requested.allow_text !== false,
                  }),
                },
              );
              await open(conversationId);
              setBusy(false);
              if (runMode === "plan") setMode("agent");
              setActiveRun(null);
              activeRunRef.current = null;
              if (heartbeatTimer) window.clearInterval(heartbeatTimer);
              worker.terminate();
              workerRef.current = undefined;
              return;
            } else throw new Error("未知工具请求");
            worker.postMessage({ type: "rpc-result", id: data.id, value });
          } else if (data.type === "delta") {
            partialText += data.text || "";
            pendingDelta += data.text || "";
            scheduleDelta();
            showStream();
          } else if (data.type === "message") {
            text += `${text && data.text ? "\n\n" : ""}${data.text || ""}`;
            partialText = "";
            if (text) showStream();
            if (data.text)
              await persistEvent("assistant_message", { text: data.text });
          } else if (data.type === "tool") {
            showAvatarState("tool");
            setToolSteps((previous) => [
              ...previous.filter((step) => step.name !== data.name),
              { name: data.name || "工具", status: data.status || "running" },
            ]);
            if (data.status === "running")
              await persistEvent("tool_call", {
                tool_call_id: data.id,
                tool_name: data.name,
                arguments: data.arguments || {},
              });
            else
              await persistEvent("tool_result", {
                tool_call_id: data.id,
                name: data.name,
                status: data.status,
                result: data.result,
              });
          } else if (data.type === "subagent") {
            await persistEvent(
              data.status === "running" ? "subagent_start" : "subagent_finish",
              {
                id: data.id,
                task: data.name,
                status: data.status,
                result: data.result,
              },
            );
          } else if (
            data.type === "done" ||
            data.type === "error" ||
            data.type === "stopped"
          ) {
            if (data.type === "error") {
              setError(data.message || "运行失败");
              showAvatarState("error", 3200);
            } else if (data.type === "stopped") {
              showAvatarState("paused", 2200);
            } else {
              showAvatarState("success", 2600);
            }
            if (data.type === "stopped")
              setError("任务已停止。执行中的外部操作请检查实际结果。");
            setSaving(true);
            await flushDelta();
            await recorder.wait();
            const terminal =
              data.type === "done"
                ? "completed"
                : data.type === "stopped"
                  ? "cancelled"
                  : "failed";
            await fetchApiJson<RunDetail>(
              `/v1/amadeus/conversations/${conversationId}/runs/${run.id}/finish`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  status: terminal,
                  error_message: data.type === "error" ? data.message : null,
                }),
              },
            );
            if (detailRef.current?.conversation.id === conversationId)
              await open(conversationId);
            setBusy(false);
            if (runMode === "plan") setMode("agent");
            setSaving(false);
            setActiveRun(null);
            activeRunRef.current = null;
            worker.terminate();
            workerRef.current = undefined;
            if (heartbeatTimer) window.clearInterval(heartbeatTimer);
          }
        } catch (cause) {
          if (data.type === "rpc")
            worker.postMessage({
              type: "rpc-result",
              id: data.id,
              error: cause instanceof Error ? cause.message : String(cause),
            });
          else {
            setError(String(cause));
            showAvatarState("error", 3200);
            setBusy(false);
            setSaving(false);
            if (heartbeatTimer) window.clearInterval(heartbeatTimer);
            worker.terminate();
            workerRef.current = undefined;
            void fetchApiJson(
              `/v1/amadeus/conversations/${conversationId}/runs/${run.id}/finish`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  status: "failed",
                  error_message: String(cause),
                }),
              },
            ).finally(() => {
              setActiveRun(null);
              activeRunRef.current = null;
            });
          }
        }
      };
      worker.postMessage({
        type: "start",
        mode: runMode,
        modelId,
        prompt: formatAmadeusPrompt(prompt, contextSnapshot, referenceSnapshot),
        history,
        tools: configured.tools,
        skills: configured.skills,
        runId: run.id,
      });
    } catch (cause) {
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      if (!options) setDraft(prompt);
      if (startedRun)
        void fetchApiJson(
          `/v1/amadeus/conversations/${startedRun.conversation_id}/runs/${startedRun.id}/finish`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "failed",
              error_message:
                cause instanceof Error ? cause.message : String(cause),
            }),
          },
        ).finally(() => {
          setActiveRun(null);
          activeRunRef.current = null;
        });
      const conflict = conversationConflict(cause);
      if (conflict) {
        if (detailRef.current?.conversation.id === conflict.id) {
          try {
            await refreshList();
            await open(conflict.id);
          } catch {
            // The submitted text remains in the draft even if refresh fails.
          }
        }
        setError(CONVERSATION_CONFLICT_MESSAGE);
      } else setError(cause instanceof Error ? cause.message : String(cause));
      showAvatarState("error", 3200);
      setBusy(false);
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
    () => groupConversations(conversations, search),
    [conversations, search],
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
    modelPickerOpen,
    setModelPickerOpen,
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
    scopedContexts,
    groups,
  };
}
