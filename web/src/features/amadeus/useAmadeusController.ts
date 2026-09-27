import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchApiJson, requestApi } from "@platform/api/client";
import type { DesktopBridge } from "@platform/desktop";
import type { AccountSessionContext } from "@features/accounts";
import { decideAmadeusApproval } from "./approval";
import { conversationActions } from "./conversationActions";
import { buildAgentHistory } from "./history";
import {
  dateGroup,
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
  type WorkerEvent,
  type WorkFile,
} from "./protocol";

export function useAmadeusController(session: AccountSessionContext) {
  const bridge = window.futurePropsDesktop as Required<DesktopBridge>;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [contexts, setContexts] = useState<Context[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [draft, setDraft] = useState("");
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
  const [approval, setApproval] = useState<Approval | null>(null);
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
  const approvalRef = useRef<Approval | null>(null);
  const avatarTimerRef = useRef<number | undefined>(undefined);
  const detailRef = useRef<Detail | null>(null);
  const contextRef = useRef<Context[]>([]);
  detailRef.current = detail;
  contextRef.current = contexts;
  activeRunRef.current = activeRun;
  approvalRef.current = approval;

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

  const refreshList = useCallback(async () => {
    const result = await fetchApiJson<{ items: Conversation[] }>(
      "/v1/amadeus/conversations",
    );
    setConversations(result.items);
    return result.items;
  }, []);
  const open = useCallback(async (id: string) => {
    const next = await fetchApiJson<Detail>(`/v1/amadeus/conversations/${id}`);
    setDetail(next);
    detailRef.current = next;
    setHistoryOpen(false);
    setReferences([]);
    setAttachments([]);
    setFilesOpen(false);
    setWorkFiles([]);
  }, []);

  useEffect(() => {
    let alive = true;
    const owner = `${session.me.user.id}:${session.me.workspace.id}`;
    setDetail(null);
    setReferences([]);
    void refreshList()
      .then((items) => {
        if (!alive) return;
        const saved = localStorage.getItem(`amadeus-current:${owner}`);
        const selected = items.find((item) => item.id === saved) || items[0];
        if (selected) void open(selected.id);
      })
      .catch((cause) => setError(String(cause)));
    void fetchApiJson<RunDetail | null>("/v1/amadeus/runs/active")
      .then(async (running) => {
        if (!alive || !running) return;
        const path = `/v1/amadeus/conversations/${running.run.conversation_id}/runs/${running.run.id}/finish`;
        const interrupted = await fetchApiJson<RunDetail>(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "interrupted",
            error_message:
              "助手窗口已重新载入，任务中断；未确认结果的操作不会自动重试。",
          }),
        });
        if (!alive) return;
        setActiveRun(null);
        setBusy(false);
        setError(interrupted.run.error_message || "上次任务已中断。");
        await open(interrupted.run.conversation_id);
      })
      .catch((cause) => setError(String(cause)));
    void fetchApiJson<{ items: ModelOption[] }>("/v1/model-inference/options")
      .then((value) => {
        if (alive) {
          setModels(value.items.filter((item) => item.id));
          setModelId(value.items[0]?.id || "");
        }
      })
      .catch(() => setModels([]));
    void bridge.amadeusContexts().then((value) => {
      if (alive) setContexts(value as Context[]);
    });
    void bridge.amadeusAlwaysOnTop().then((value) => {
      if (alive && typeof value === "boolean") setAlwaysOnTop(value);
    });
    const offContexts = bridge.onAmadeusContexts((value) =>
      setContexts(value as Context[]),
    );
    const offReference = bridge.onAmadeusReference((value) => {
      const reference = value as Reference;
      const origin = contextRef.current.find(
        (item) => item.windowId === reference.windowId,
      );
      if (
        origin?.userId === session.me.user.id &&
        origin.workspaceId === session.me.workspace.id
      )
        setReferences((previous) => [...previous, reference].slice(0, 20));
    });
    const offPickFinished = bridge.onAmadeusPickFinished?.(() => {
      setAvatarState((current) => (current === "listening" ? "idle" : current));
    });
    return () => {
      alive = false;
      offContexts();
      offReference();
      offPickFinished?.();
      modelAbortRef.current?.abort();
      workerRef.current?.terminate();
      approvalRef.current?.reject(new Error("助手窗口已重新载入"));
      const run = activeRunRef.current;
      if (run)
        void fetchApiJson(
          `/v1/amadeus/conversations/${run.conversation_id}/runs/${run.id}/cancel`,
          { method: "POST" },
        ).catch(() => undefined);
      if (avatarTimerRef.current) window.clearTimeout(avatarTimerRef.current);
    };
  }, [session.me.user.id, session.me.workspace.id, bridge, open, refreshList]);

  const conversationId = detail?.conversation.id;
  useEffect(() => {
    if (!conversationId) return;
    localStorage.setItem(
      `amadeus-current:${session.me.user.id}:${session.me.workspace.id}`,
      conversationId,
    );
  }, [conversationId, session.me.user.id, session.me.workspace.id]);

  useEffect(() => {
    if (!conversationId) {
      setLoaded([]);
      setLoadedConversationId(null);
      return;
    }
    try {
      setLoaded(
        JSON.parse(
          localStorage.getItem(`amadeus-loaded:${conversationId}`) || "[]",
        ),
      );
    } catch {
      setLoaded([]);
    }
    setLoadedConversationId(conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || loadedConversationId !== conversationId) return;
    localStorage.setItem(
      `amadeus-loaded:${conversationId}`,
      JSON.stringify(loaded),
    );
  }, [loaded, conversationId, loadedConversationId]);

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
  const decideApproval = (allow: boolean) =>
    decideAmadeusApproval({
      allow,
      current: approval,
      contexts,
      session,
      bridge,
      detailRef,
      activeActionRef,
      setApproval,
      setDetail,
      setError,
      setScriptOutput,
    });

  const stop = () => {
    showAvatarState("paused", 2200);
    const pendingApproval = approval;
    setApproval(null);
    pendingApproval?.reject(new Error("用户停止了任务"));
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

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || busy || !modelId) return;
    const referenceSnapshot = references;
    const contextSnapshot = contexts.filter(
      (item) =>
        item.userId === session.me.user.id &&
        item.workspaceId === session.me.workspace.id,
    );
    setBusy(true);
    showAvatarState("thinking");
    setError("");
    setDraft("");
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
        current = { conversation: created, messages: [], actions: [] };
        setDetail(current);
      }
      const previousRuns = await fetchApiJson<RunDetail[]>(
        `/v1/amadeus/conversations/${current.conversation.id}/runs`,
      );
      const history = buildAgentHistory(current.messages, previousRuns);
      const updated = await fetchApiJson<Detail>(
        `/v1/amadeus/conversations/${current.conversation.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_revision: current.conversation.revision,
            role: "user",
            content: prompt,
            references: referenceSnapshot.map(({ windowId, ...item }) => ({
              ...item,
              window_id: windowId,
            })),
          }),
        },
      );
      setDetail(updated);
      detailRef.current = updated;
      setReferences([]);
      await refreshList();
      const configuredTools: Array<{
        name: string;
        key: string;
        label: string;
        description: string;
        schema: Record<string, unknown>;
      }> = [];
      for (const item of toolApis.filter(
        (item) => loaded.includes(`toolapi:${item.id}`) && item.enabled,
      ))
        configuredTools.push({
          name: `amadeus_api_${configuredTools.length}`,
          key: `tool_api:${item.id}`,
          label: item.name,
          description: item.description || item.name,
          schema: item.parameters_schema || { type: "object" },
        });
      for (const item of mcpServers.filter(
        (item) => loaded.includes(`mcp:${item.id}`) && item.enabled,
      )) {
        const found = await fetchApiJson<
          Array<{
            name: string;
            description: string;
            input_schema: Record<string, unknown>;
          }>
        >(`/v1/integrations/mcp/${item.id}/tools`);
        for (const tool of found)
          configuredTools.push({
            name: `amadeus_mcp_${configuredTools.length}`,
            key: `mcp:${item.id}:${tool.name}`,
            label: `${item.name} · ${tool.name}`,
            description: tool.description,
            schema: tool.input_schema || { type: "object" },
          });
      }
      const loadedSkills = await Promise.all(
        skills
          .filter((item) => loaded.includes(`skill:${item.id}`) && item.enabled)
          .map(async (item) => ({
            id: item.id,
            ...(await fetchApiJson<{
              name: string;
              version: string;
              content: string;
            }>(
              `/v1/amadeus/conversations/${updated.conversation.id}/skills/${item.id}/load`,
              { method: "POST" },
            )),
          })),
      );
      const runDetail = await fetchApiJson<RunDetail>(
        `/v1/amadeus/conversations/${updated.conversation.id}/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model_id: modelId,
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
      let eventIndex = 0;
      let deltaTimer: number | undefined;
      let persistence = Promise.resolve();
      const persistEvent = (kind: string, payload: Record<string, unknown>) => {
        const idempotencyKey = `${kind}-${++eventIndex}`;
        persistence = persistence.then(async () => {
          await fetchApiJson(
            `/v1/amadeus/conversations/${conversationId}/runs/${run.id}/events`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kind,
                payload,
                idempotency_key: idempotencyKey,
              }),
            },
          );
        });
        return persistence;
      };
      const flushDelta = () => {
        if (deltaTimer) window.clearTimeout(deltaTimer);
        deltaTimer = undefined;
        if (!pendingDelta) return persistence;
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
              const controller = new AbortController();
              modelAbortRef.current = controller;
              try {
                const response = await requestApi(
                  "/v1/amadeus/model-turn/stream",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data.payload),
                    signal: controller.signal,
                  },
                );
                const reader = response.body?.getReader();
                if (!reader) throw new Error("模型流不可用");
                const decoder = new TextDecoder();
                let buffer = "";
                let result: unknown;
                while (true) {
                  const { done, value: chunk } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(chunk, { stream: true });
                  const lines = buffer.split("\n");
                  buffer = lines.pop() || "";
                  for (const line of lines) {
                    if (!line) continue;
                    const event = JSON.parse(line) as {
                      type: string;
                      text?: string;
                      tool_calls?: unknown[];
                      usage?: unknown;
                      message?: string;
                    };
                    if (event.type === "delta")
                      worker.postMessage({
                        type: "rpc-delta",
                        id: data.id,
                        text: event.text || "",
                      });
                    else if (event.type === "end")
                      result = {
                        tool_calls: event.tool_calls,
                        usage: event.usage,
                      };
                    else if (event.type === "error")
                      throw new Error(event.message || "模型调用失败");
                  }
                }
                if (!result) throw new Error("模型流提前中断");
                value = result;
              } finally {
                modelAbortRef.current = undefined;
              }
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
                !loadedSkills.some(
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
              const action = await fetchApiJson<{
                id: string;
                tool_name: string;
                arguments: Record<string, unknown>;
                arguments_sha256: string;
              }>(`/v1/amadeus/conversations/${conversationId}/actions`, {
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
              });
              await persistEvent("tool_call", {
                tool_call_id: requested.tool_call_id,
                tool_name: requested.tool_name,
                arguments: requested.arguments,
                action_id: action.id,
              });
              value = await new Promise((resolve, reject) =>
                setApproval({
                  ...action,
                  conversationId,
                  runId: run.id,
                  resolve,
                  reject,
                }),
              );
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
          } else if (data.type === "tool") {
            showAvatarState("tool");
            setToolSteps((previous) => [
              ...previous.filter((step) => step.name !== data.name),
              { name: data.name || "工具", status: data.status || "running" },
            ]);
            if (data.status !== "running")
              await persistEvent("tool_result", {
                tool_call_id: data.id,
                name: data.name,
                status: data.status,
                result: data.result,
              });
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
            await persistence;
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
            const persisted = await fetchApiJson<Detail>(
              `/v1/amadeus/conversations/${conversationId}`,
            );
            if (detailRef.current?.conversation.id === conversationId) {
              setDetail(persisted);
              detailRef.current = persisted;
            }
            setBusy(false);
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
        modelId,
        prompt:
          `${prompt}\n\n[当前窗口] ${JSON.stringify(
            contextSnapshot.map((item) => ({
              application: item.application,
              projectId: item.projectId,
              path: item.path,
              unsaved: item.unsaved,
              selection: item.selection,
            })),
          )}\n` +
          (referenceSnapshot.length
            ? `[手动引用] ${JSON.stringify(
                referenceSnapshot.map((item) => ({
                  name: item.name,
                  application: item.application,
                  value: item.value,
                  source: item.source,
                })),
              )} `
            : ""),
        history,
        tools: configuredTools,
        skills: loadedSkills,
        runId: run.id,
      });
    } catch (cause) {
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
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
      setError(cause instanceof Error ? cause.message : String(cause));
      showAvatarState("error", 3200);
      setBusy(false);
      setDraft(prompt);
    }
  };

  const scopedContexts = contexts.filter(
    (item) =>
      item.userId === session.me.user.id &&
      item.workspaceId === session.me.workspace.id,
  );
  const groups = useMemo(() => {
    const filtered = conversations.filter((item) =>
      item.title.toLowerCase().includes(search.toLowerCase()),
    );
    return ["今天", "昨天", "更早"]
      .map((name) => ({
        name,
        items: filtered.filter((item) => dateGroup(item.updated_at) === name),
      }))
      .filter((group) => group.items.length);
  }, [conversations, search]);

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
    approval,
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
