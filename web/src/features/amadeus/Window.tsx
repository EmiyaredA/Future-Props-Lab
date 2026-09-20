import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  History,
  Plus,
  Search,
  X,
  Paperclip,
  FolderOpen,
  MousePointer2,
  Boxes,
  Send,
  Square,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { fetchApiJson, requestApi } from "@platform/api/client";
import type { DesktopBridge } from "@platform/desktop";
import type { AccountSessionContext } from "@features/accounts";

type Conversation = {
  id: string;
  title: string;
  model_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};
type Reference = {
  id: string;
  windowId?: number;
  window_id?: number;
  application: string;
  name: string;
  value: string;
  source: string;
  thumbnail?: string;
};
type ChatMessage = {
  id: string;
  role: string;
  content: string;
  references: Reference[];
  created_at: string;
};
type SavedAction = {
  id: string;
  tool_name: string;
  status: string;
  arguments: Record<string, unknown>;
  result?: Record<string, unknown>;
  created_at: string;
};
type Detail = {
  conversation: Conversation;
  messages: ChatMessage[];
  actions: SavedAction[];
};
type Context = {
  windowId: number;
  application?: string;
  projectId?: string;
  selection?: { name: string; value: string };
  unsaved?: boolean;
  focused: boolean;
  path?: string;
  userId?: string;
  workspaceId?: string;
};
type ModelOption = { id: string; label: string };
type WorkFile = { kind: string; name: string; bytes: number; sha256: string };
type Capability = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  status: string;
  revision: number;
  parameters_schema?: Record<string, unknown>;
  default_version?: string;
  latest_version?: string;
  sensitive_result?: boolean;
  status_message?: string;
};
type Approval = {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  arguments_sha256: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
type WorkerEvent = {
  type: "rpc" | "delta" | "message" | "tool" | "done" | "error" | "stopped";
  id?: number;
  method?: string;
  payload?: unknown;
  text?: string;
  name?: string;
  status?: string;
  message?: string;
};

function dateGroup(value: string) {
  const today = new Date();
  const item = new Date(value);
  if (item.toDateString() === today.toDateString()) return "今天";
  today.setDate(today.getDate() - 1);
  return item.toDateString() === today.toDateString() ? "昨天" : "更早";
}

function compactContext(items: Context[]) {
  return `${items.length} 个窗口 · ${new Set(items.map((item) => item.application || "研究所")).size} 个应用`;
}

function safeReadPath(value: unknown) {
  const path = String((value as { path?: string })?.path || "");
  if (path.includes("..") || /%2e|%2f|%5c/i.test(path))
    throw new Error("读取路径无效");
  const resolved = new URL(path, window.location.origin);
  if (
    resolved.origin !== window.location.origin ||
    !/^\/v1\/(video-editor|visual-workshop|thought-workshop|presentation-workshop|galgame-workshop|audio-annotation|director-desk|motion-compositor)(?:\/[a-zA-Z0-9_/?=&.%-]*)?$/.test(
      path,
    ) ||
    resolved.pathname !== path.split("?", 1)[0]
  )
    throw new Error("只能读取已授权的应用项目");
  return path;
}

export function AmadeusWindow({ session }: { session: AccountSessionContext }) {
  const bridge = window.futurePropsDesktop as Required<DesktopBridge>;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [contexts, setContexts] = useState<Context[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [references, setReferences] = useState<Reference[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workerRef = useRef<Worker | undefined>(undefined);
  const modelAbortRef = useRef<AbortController | undefined>(undefined);
  const activeActionRef = useRef<{
    conversationId: string;
    actionId: string;
  } | null>(null);
  const detailRef = useRef<Detail | null>(null);
  const contextRef = useRef<Context[]>([]);
  detailRef.current = detail;
  contextRef.current = contexts;

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
    if (localStorage.getItem(`amadeus-running:${id}`) && !workerRef.current) {
      localStorage.removeItem(`amadeus-running:${id}`);
      setError(
        "上次会话任务在窗口或后端重启时中断；未确认结果的操作不会自动重试。",
      );
    }
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
    return () => {
      alive = false;
      offContexts();
      offReference();
      modelAbortRef.current?.abort();
      workerRef.current?.terminate();
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
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    localStorage.setItem(
      `amadeus-loaded:${conversationId}`,
      JSON.stringify(loaded),
    );
  }, [loaded, conversationId]);

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
  const toggleLoaded = (key: string) =>
    setLoaded((previous) =>
      previous.includes(key)
        ? previous.filter((item) => item !== key)
        : [...previous, key],
    );

  const decideApproval = async (allow: boolean) => {
    const current = approval;
    const conversationId = detailRef.current?.conversation.id;
    if (!current || !conversationId) return;
    const pathParams = current.arguments.path_params;
    const projectId =
      current.arguments.project_id ??
      (pathParams &&
      typeof pathParams === "object" &&
      "project_id" in pathParams
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
          item.workspaceId === session.me.workspace.id,
      )
    ) {
      setError("目标项目有未保存的编辑。请先在原窗口保存，再确认这项操作。");
      return;
    }
    setApproval(null);
    try {
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
        current.resolve({ rejected: true, message: "用户拒绝执行" });
        return;
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
          workspaceId: session.me.workspace.id,
        });
      if (
        outcome.status === "completed" &&
        current.tool_name.startsWith("fpl_operation:")
      )
        await bridge.publishAmadeusMutation({
          application: "*",
          projectId,
          userId: session.me.user.id,
          workspaceId: session.me.workspace.id,
        });
      const snapshot = await fetchApiJson<Detail>(
        `/v1/amadeus/conversations/${conversationId}`,
      );
      if (detailRef.current?.conversation.id === conversationId)
        setDetail(snapshot);
      current.resolve(outcome);
    } catch (cause) {
      current.reject(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      activeActionRef.current = null;
    }
  };

  const stop = () => {
    modelAbortRef.current?.abort();
    workerRef.current?.postMessage({ type: "stop" });
    const active = activeActionRef.current;
    if (active)
      void fetchApiJson(
        `/v1/amadeus/conversations/${active.conversationId}/actions/${active.actionId}/cancel`,
        { method: "POST" },
      ).catch(() => setError("停止请求已发出；请检查操作的最终状态。"));
  };

  const create = async () => {
    const next = await fetchApiJson<Conversation>("/v1/amadeus/conversations", {
      method: "POST",
    });
    await refreshList();
    await open(next.id);
  };
  const rename = async (item: Conversation, title: string) => {
    title = title.trim();
    if (!title || title === item.title) {
      setRenameItem(null);
      return;
    }
    await fetchApiJson(`/v1/amadeus/conversations/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_revision: item.revision, title }),
    });
    await refreshList();
    if (detailRef.current?.conversation.id === item.id) await open(item.id);
    setRenameItem(null);
  };
  const remove = async (item: Conversation) => {
    if (busy) {
      setError("请先停止当前任务，再删除会话和工作文件。");
      return;
    }
    await requestApi(
      `/v1/amadeus/conversations/${item.id}?expected_revision=${item.revision}`,
      { method: "DELETE" },
    );
    const next = await refreshList();
    if (detailRef.current?.conversation.id === item.id) {
      if (next[0]) await open(next[0].id);
      else setDetail(null);
    }
    setDeleteItem(null);
  };

  const importAttachment = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      setError("单个文件不能超过 50 MiB");
      return;
    }
    try {
      let current = detailRef.current;
      if (!current) {
        const created = await fetchApiJson<Conversation>(
          "/v1/amadeus/conversations",
          { method: "POST" },
        );
        current = { conversation: created, messages: [], actions: [] };
        setDetail(current);
        detailRef.current = current;
        await refreshList();
      }
      const form = new FormData();
      form.append("upload", file, file.name);
      await fetchApiJson(
        `/v1/amadeus/conversations/${current.conversation.id}/imports`,
        { method: "POST", body: form },
      );
      setAttachments((previous) => [
        ...previous,
        { name: file.name, bytes: file.size },
      ]);
      setReferences((previous) => [
        ...previous,
        {
          id: `file:${file.name}`,
          application: "会话文件",
          name: file.name,
          value: `${Math.ceil(file.size / 1024)} KiB`,
          source: "imports",
        },
      ]);
      const listing = await fetchApiJson<{ items: WorkFile[] }>(
        `/v1/amadeus/conversations/${current.conversation.id}/files`,
      );
      setWorkFiles(listing.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const showFiles = async () => {
    setFilesOpen(!filesOpen);
    if (filesOpen || !detailRef.current) return;
    try {
      const listing = await fetchApiJson<{ items: WorkFile[] }>(
        `/v1/amadeus/conversations/${detailRef.current.conversation.id}/files`,
      );
      setWorkFiles(listing.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const fileUrl = (item: WorkFile) =>
    `/v1/amadeus/conversations/${detailRef.current?.conversation.id}/files/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.name)}`;
  const previewFile = async (item: WorkFile) => {
    if (item.bytes > 1024 * 1024) {
      setError("预览文件不能超过 1 MiB");
      return;
    }
    try {
      const response = await requestApi(fileUrl(item));
      setFilePreview({ name: item.name, text: await response.text() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const downloadFile = async (item: WorkFile) => {
    try {
      const response = await requestApi(fileUrl(item));
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || busy || !modelId) return;
    setBusy(true);
    setError("");
    setDraft("");
    setToolSteps([]);
    setScriptOutput("");
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
      const history = current.messages.map((message) => ({
        role: message.role,
        content:
          message.content +
          (message.references?.length
            ? `\n[当时引用] ${message.references.map((item) => `${item.application}/${item.name}: ${item.value}`).join("; ")}`
            : ""),
      }));
      const updated = await fetchApiJson<Detail>(
        `/v1/amadeus/conversations/${current.conversation.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_revision: current.conversation.revision,
            role: "user",
            content: prompt,
            references: references.map(({ windowId, ...item }) => ({
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
          .map((item) =>
            fetchApiJson<{ name: string; content: string }>(
              `/v1/amadeus/conversations/${updated.conversation.id}/skills/${item.id}/load`,
              { method: "POST" },
            ),
          ),
      );
      const worker = new Worker(new URL("./agent.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      const conversationId = updated.conversation.id;
      localStorage.setItem(`amadeus-running:${conversationId}`, "1");
      let text = "";
      let partialText = "";
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
            } else if (data.method === "invoke") {
              const requested = data.payload as {
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
                  arguments:
                    builtInTool || registeredTool
                      ? requested.arguments
                      : {
                          input: requested.arguments,
                          revision: tool!.revision,
                        },
                }),
              });
              value = await new Promise((resolve, reject) =>
                setApproval({ ...action, resolve, reject }),
              );
            } else throw new Error("未知工具请求");
            worker.postMessage({ type: "rpc-result", id: data.id, value });
          } else if (data.type === "delta") {
            partialText += data.text || "";
            showStream();
          } else if (data.type === "message") {
            text += `${text && data.text ? "\n\n" : ""}${data.text || ""}`;
            partialText = "";
            if (text) showStream();
          } else if (data.type === "tool") {
            setToolSteps((previous) => [
              ...previous.filter((step) => step.name !== data.name),
              { name: data.name || "工具", status: data.status || "running" },
            ]);
          } else if (
            data.type === "done" ||
            data.type === "error" ||
            data.type === "stopped"
          ) {
            if (data.type === "error") setError(data.message || "运行失败");
            if (data.type === "stopped")
              setError("任务已停止。执行中的外部操作请检查实际结果。");
            if (text) {
              const snapshot = await fetchApiJson<Detail>(
                `/v1/amadeus/conversations/${conversationId}`,
              );
              const persisted = await fetchApiJson<Detail>(
                `/v1/amadeus/conversations/${conversationId}/messages`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    expected_revision: snapshot.conversation.revision,
                    role: "assistant",
                    content: text,
                    references: [],
                  }),
                },
              );
              if (detailRef.current?.conversation.id === conversationId) {
                setDetail(persisted);
                detailRef.current = persisted;
              }
            }
            setBusy(false);
            worker.terminate();
            workerRef.current = undefined;
            localStorage.removeItem(`amadeus-running:${conversationId}`);
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
            setBusy(false);
          }
        }
      };
      const scopedContexts = contexts.filter(
        (item) =>
          item.userId === session.me.user.id &&
          item.workspaceId === session.me.workspace.id,
      );
      worker.postMessage({
        type: "start",
        modelId,
        prompt:
          `${prompt}\n\n[当前窗口] ${JSON.stringify(
            scopedContexts.map((item) => ({
              application: item.application,
              projectId: item.projectId,
              path: item.path,
              unsaved: item.unsaved,
              selection: item.selection,
            })),
          )}\n` +
          (references.length
            ? `[手动引用] ${JSON.stringify(
                references.map((item) => ({
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
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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

  return (
    <div className="amadeus-window">
      <header className="amadeus-header">
        <div className="amadeus-brand">
          <span className="amadeus-mark">✦</span>
          <div>
            <strong>Amadeus</strong>
            <small>已保存到本机</small>
          </div>
        </div>
        <div className="amadeus-header-actions">
          <button
            title="历史对话"
            aria-label="历史对话"
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <History size={17} />
          </button>
          <button
            title="新建对话"
            aria-label="新建对话"
            onClick={() => void create()}
          >
            <Plus size={18} />
          </button>
          <button
            title="关闭窗口"
            aria-label="关闭窗口"
            onClick={() => void bridge.hideAmadeus()}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="amadeus-body">
        {historyOpen && (
          <aside className="amadeus-history">
            <div className="amadeus-history-head">
              <strong>对话历史</strong>
              <button onClick={() => void create()}>
                <Plus size={15} />
                新建
              </button>
            </div>
            <label className="amadeus-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索本地对话"
              />
            </label>
            {groups.map((group) => (
              <section key={group.name}>
                <h3>{group.name}</h3>
                {group.items.map((item) => (
                  <div
                    className={`amadeus-history-row ${detail?.conversation.id === item.id ? "active" : ""}`}
                    key={item.id}
                  >
                    <button
                      className="amadeus-history-title"
                      onClick={() => void open(item.id)}
                    >
                      {item.title}
                    </button>
                    <button
                      title="重命名"
                      onClick={() => {
                        setRenameItem(item);
                        setRenameTitle(item.title);
                      }}
                    >
                      ⋯
                    </button>
                    <button
                      title={busy ? "请先停止当前任务" : "删除"}
                      disabled={busy}
                      onClick={() => setDeleteItem(item)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </section>
            ))}
            {renameItem && (
              <form
                className="amadeus-history-dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  void rename(renameItem, renameTitle);
                }}
              >
                <strong>重命名对话</strong>
                <input
                  autoFocus
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.target.value)}
                />
                <div>
                  <button type="button" onClick={() => setRenameItem(null)}>
                    取消
                  </button>
                  <button type="submit">保存</button>
                </div>
              </form>
            )}
            {deleteItem && (
              <div className="amadeus-history-dialog">
                <strong>删除「{deleteItem.title}」？</strong>
                <p>这会同时删除本地消息与会话文件。</p>
                <div>
                  <button onClick={() => setDeleteItem(null)}>取消</button>
                  <button onClick={() => void remove(deleteItem)}>删除</button>
                </div>
              </div>
            )}
          </aside>
        )}
        <main className="amadeus-chat">
          <button
            className="amadeus-context-summary"
            onClick={() => setContextOpen(!contextOpen)}
          >
            {contextOpen ? (
              <ChevronDown size={15} />
            ) : (
              <ChevronRight size={15} />
            )}
            当前上下文 · {compactContext(scopedContexts)}
          </button>
          {contextOpen && (
            <div className="amadeus-context-list">
              <small>自动获取的环境信息</small>
              {scopedContexts.map((item) => (
                <div key={item.windowId}>
                  <strong>{item.application || "研究所"}</strong>
                  {item.focused && <em>活动窗口</em>}
                  <span>
                    {item.projectId || item.path || "首页"}
                    {item.unsaved ? " · 有未保存更改" : ""}
                    {item.selection
                      ? ` · 选中：${item.selection.name}（${item.selection.value}）`
                      : ""}
                  </span>
                </div>
              ))}
              <small>手动引用会显示在输入框上方</small>
            </div>
          )}
          {capabilitiesOpen && (
            <div className="amadeus-capabilities">
              <div className="amadeus-capabilities-head">
                <strong>能力</strong>
                <button
                  onClick={() => setCapabilitiesOpen(false)}
                  aria-label="收起能力"
                >
                  <X size={15} />
                </button>
              </div>
              <section>
                <h3>会话脚本</h3>
                <p>
                  Python 与受限 Shell ·{" "}
                  {scriptAvailable
                    ? "系统沙箱可用 · 执行前确认"
                    : "系统沙箱不可用"}
                </p>
              </section>
              <section>
                <h3>FPL 工具 · {registeredOperations}</h3>
                <p>
                  当前 Workspace
                  已登记的业务操作，按应用按需加载；读取自动执行，修改逐项确认。
                </p>
              </section>
              {(
                [
                  { title: "工具 API", prefix: "toolapi", items: toolApis },
                  { title: "MCP", prefix: "mcp", items: mcpServers },
                  { title: "Skills", prefix: "skill", items: skills },
                ] as const
              ).map((group) => (
                <section key={group.title}>
                  <h3>
                    {group.title} · {group.items.length}
                  </h3>
                  {!group.items.length && <p>暂无资源</p>}
                  {group.items.map((item) => (
                    <label key={item.id} className="amadeus-capability">
                      <input
                        type="checkbox"
                        checked={loaded.includes(`${group.prefix}:${item.id}`)}
                        disabled={!item.enabled}
                        onChange={() =>
                          toggleLoaded(`${group.prefix}:${item.id}`)
                        }
                      />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.status_message ||
                            item.description ||
                            "来自集成中心"}
                        </small>
                      </span>
                      <em className={item.status === "failed" ? "failed" : ""}>
                        {!item.enabled
                          ? "不可用"
                          : loaded.includes(`${group.prefix}:${item.id}`)
                            ? "已加载"
                            : item.status === "failed"
                              ? group.prefix === "skill"
                                ? item.status_message?.includes("依赖")
                                  ? "依赖缺失"
                                  : "不可用"
                                : "连接异常"
                              : "可用"}
                      </em>
                    </label>
                  ))}
                </section>
              ))}
            </div>
          )}
          {filesOpen && (
            <div className="amadeus-files">
              <div className="amadeus-capabilities-head">
                <strong>会话文件</strong>
                <button
                  aria-label="收起会话文件"
                  onClick={() => setFilesOpen(false)}
                >
                  <X size={15} />
                </button>
              </div>
              {!detail && <p>新建对话后可导入文件。</p>}
              {detail && (
                <button
                  onClick={() =>
                    void fetchApiJson(
                      `/v1/amadeus/conversations/${detail.conversation.id}/files/open-folder`,
                      { method: "POST" },
                    ).catch((cause) =>
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      ),
                    )
                  }
                >
                  在访达中打开目录
                </button>
              )}
              {!workFiles.length && <p>暂无文件</p>}
              {workFiles.map((item) => (
                <div
                  className="amadeus-file-row"
                  key={`${item.kind}/${item.name}`}
                >
                  <span>
                    {item.kind} / {item.name} · {Math.ceil(item.bytes / 1024)}{" "}
                    KiB
                  </span>
                  <button onClick={() => void previewFile(item)}>预览</button>
                  <button onClick={() => void downloadFile(item)}>下载</button>
                </div>
              ))}
            </div>
          )}
          <div className="amadeus-messages">
            {!detail?.messages.length && (
              <div className="amadeus-welcome">
                <div>✦</div>
                <h1>你好，我是 Amadeus</h1>
                <p>
                  可以读取当前应用、解释选中的控件，或帮助你完成跨应用工作。
                </p>
                <button onClick={() => setDraft("帮我看看当前窗口里的项目")}>
                  看看当前窗口里的项目
                </button>
                <button onClick={() => setDraft("解释一下我选中的对象")}>
                  解释选中的对象
                </button>
              </div>
            )}
            {detail?.messages.map((message) => (
              <article
                key={message.id}
                className={`amadeus-message ${message.role}`}
              >
                <div className="amadeus-message-name">
                  {message.role === "user" ? "你" : "✦ Amadeus"}
                </div>
                {message.references?.length > 0 && (
                  <div className="amadeus-message-refs">
                    {message.references.map((item, index) => (
                      <button
                        key={`${item.id}-${index}`}
                        className="amadeus-ref"
                        onClick={() => setPreviewReference(item)}
                      >
                        <span className="amadeus-ref-thumb">
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" />
                          ) : (
                            "▧"
                          )}
                        </span>
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.application}
                            {item.value ? ` · ${item.value}` : ""}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </article>
            ))}
            {toolSteps.length > 0 && (
              <details className="amadeus-steps" open={busy}>
                <summary>执行步骤 · {toolSteps.length}</summary>
                {toolSteps.map((step) => (
                  <div key={step.name}>
                    {step.name} ·{" "}
                    {step.status === "done"
                      ? "已完成"
                      : step.status === "failed"
                        ? "失败"
                        : "进行中"}
                  </div>
                ))}
              </details>
            )}
            {scriptOutput && (
              <details className="amadeus-steps" open={busy}>
                <summary>脚本输出</summary>
                <pre>{scriptOutput}</pre>
              </details>
            )}
            {!!detail?.actions.length && (
              <details className="amadeus-steps">
                <summary>历史操作 · {detail.actions.length}</summary>
                {detail.actions.map((action) => (
                  <details key={action.id}>
                    <summary>
                      {action.tool_name} ·{" "}
                      {action.status === "completed"
                        ? "已完成"
                        : action.status === "failed"
                          ? "失败"
                          : action.status === "unknown"
                            ? "结果待核实"
                            : action.status === "rejected"
                              ? "已拒绝"
                              : "待处理"}
                    </summary>
                    <pre>
                      {JSON.stringify(
                        { arguments: action.arguments, result: action.result },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                ))}
              </details>
            )}
            {approval && (
              <section className="amadeus-approval">
                <strong>确认执行 · {approval.tool_name}</strong>
                {Array.isArray(approval.arguments.operations) && (
                  <ol className="amadeus-operation-list">
                    {approval.arguments.operations.map((operation, index) => (
                      <li key={index}>
                        第 {index + 1} 项 ·{" "}
                        {operation &&
                        typeof operation === "object" &&
                        "type" in operation
                          ? String(operation.type)
                          : "操作"}
                      </li>
                    ))}
                  </ol>
                )}
                <pre>{JSON.stringify(approval.arguments, null, 2)}</pre>
                <div>
                  <button onClick={() => void decideApproval(false)}>
                    拒绝
                  </button>
                  <button onClick={() => void decideApproval(true)}>
                    批准并执行
                  </button>
                </div>
              </section>
            )}
          </div>
          <div className="amadeus-bottom">
            {error && (
              <div className="amadeus-error" role="alert">
                {error}
              </div>
            )}
            <div className="amadeus-composer">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                onChange={(event) => {
                  void Promise.all(
                    [...(event.target.files || [])].map(importAttachment),
                  );
                  event.target.value = "";
                }}
              />
              {attachments.length > 0 && (
                <div className="amadeus-attachments">
                  已导入：{attachments.map((item) => item.name).join("、")}
                </div>
              )}
              {references.length > 0 && (
                <div className="amadeus-pending-refs">
                  {references.map((item, index) => (
                    <div className="amadeus-ref" key={`${item.id}-${index}`}>
                      <button
                        className="amadeus-ref-content"
                        onClick={() => setPreviewReference(item)}
                      >
                        <span className="amadeus-ref-thumb">
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" />
                          ) : (
                            "▧"
                          )}
                        </span>
                        <span>
                          <strong>
                            {index + 1}. {item.name}
                          </strong>
                          <small>
                            {item.application}
                            {item.value ? ` · ${item.value}` : ""}
                          </small>
                        </span>
                      </button>
                      <button
                        title="移除引用"
                        onClick={() =>
                          setReferences(
                            references.filter((_, at) => at !== index),
                          )
                        }
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                aria-label="向 Amadeus 提问"
                placeholder="描述你的想法，或选取应用中的控件…"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="amadeus-toolbar">
                <button
                  title="导入会话文件"
                  aria-label="导入会话文件"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip size={17} />
                </button>
                <button
                  title="会话文件"
                  aria-label="会话文件"
                  onClick={() => void showFiles()}
                >
                  <FolderOpen size={17} />
                </button>
                <button
                  title="选取控件"
                  aria-label="选取控件"
                  onClick={() =>
                    void bridge.setAmadeusPickMode(true, references.length + 1)
                  }
                >
                  <MousePointer2 size={17} />
                  <span>选取控件</span>
                </button>
                <button
                  title="能力"
                  aria-label="能力"
                  onClick={() => void openCapabilities()}
                >
                  <Boxes size={17} />
                  <span>能力 {loaded.length || ""}</span>
                </button>
                <div className="amadeus-spacer" />
                <div className="amadeus-model-control">
                  <button
                    aria-label="选择模型"
                    aria-expanded={modelPickerOpen}
                    onClick={() => setModelPickerOpen(!modelPickerOpen)}
                  >
                    {models.find((item) => item.id === modelId)?.label ||
                      "没有可用模型"}
                    <ChevronDown size={13} />
                  </button>
                  {modelPickerOpen && (
                    <div role="listbox" className="amadeus-model-list">
                      {models.map((item) => (
                        <button
                          role="option"
                          aria-selected={modelId === item.id}
                          key={item.id}
                          onClick={() => {
                            setModelId(item.id);
                            setModelPickerOpen(false);
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="amadeus-send"
                  title={busy ? "停止" : "发送"}
                  aria-label={busy ? "停止" : "发送"}
                  onClick={() => (busy ? stop() : void send())}
                >
                  {busy ? <Square size={16} /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
      {previewReference && (
        <div
          className="amadeus-reference-backdrop"
          role="presentation"
          onClick={() => setPreviewReference(null)}
        >
          <section
            className="amadeus-reference-detail"
            role="dialog"
            aria-label="引用详情"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <strong>{previewReference.name}</strong>
              <button
                aria-label="关闭引用详情"
                onClick={() => setPreviewReference(null)}
              >
                <X size={16} />
              </button>
            </div>
            {previewReference.thumbnail && (
              <img
                src={previewReference.thumbnail}
                alt={previewReference.name}
              />
            )}
            <p>
              {previewReference.application}
              {previewReference.value ? ` · ${previewReference.value}` : ""}
            </p>
            {(previewReference.windowId || previewReference.window_id) && (
              <button
                onClick={() =>
                  void bridge
                    .locateAmadeusReference({
                      windowId:
                        previewReference.windowId || previewReference.window_id,
                      id: previewReference.id,
                    })
                    .then((found) => {
                      if (!found) setError("来源窗口已关闭");
                      else setPreviewReference(null);
                    })
                }
              >
                定位来源
              </button>
            )}
          </section>
        </div>
      )}
      {filePreview && (
        <div
          className="amadeus-reference-backdrop"
          role="presentation"
          onClick={() => setFilePreview(null)}
        >
          <section
            className="amadeus-reference-detail"
            role="dialog"
            aria-label="文件预览"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <strong>{filePreview.name}</strong>
              <button
                aria-label="关闭文件预览"
                onClick={() => setFilePreview(null)}
              >
                <X size={16} />
              </button>
            </div>
            <pre>{filePreview.text}</pre>
          </section>
        </div>
      )}
    </div>
  );
}
