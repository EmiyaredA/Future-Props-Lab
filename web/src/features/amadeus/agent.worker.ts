import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { normalizeOperationBody } from "./operationArguments";
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  Type,
  type AssistantMessage,
  type Model,
  type Message,
  type JsonObject,
  type TranscriptContext,
} from "@earendil-works/pi-ai";

type RpcRequest = { type: "rpc"; id: number; method: string; payload: unknown };
type RpcReply = {
  type: "rpc-result";
  id: number;
  value?: unknown;
  error?: string;
};
type RpcDelta = { type: "rpc-delta"; id: number; text: string };
type LoadedTool = {
  name: string;
  key: string;
  label: string;
  description: string;
  schema: Record<string, unknown>;
};
type Start = {
  type: "start";
  mode: "agent" | "plan";
  runId: string;
  modelId: string;
  prompt: string;
  history: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    tool_calls?: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
    tool_call_id?: string;
    tool_name?: string;
  }>;
  tools: LoadedTool[];
  skills: Array<{ id: string; version: string; name: string; content: string }>;
};

let agent: Agent | undefined;
let activeRunId = "";
let sequence = 0;
let stopRequested = false;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    onDelta?: (text: string) => void;
  }
>();

function rpc<T>(method: string, payload: unknown): Promise<T> {
  const id = ++sequence;
  self.postMessage({ type: "rpc", id, method, payload } satisfies RpcRequest);
  return new Promise((resolve, reject) =>
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    }),
  );
}

function rpcStream<T>(
  method: string,
  payload: unknown,
  onDelta: (text: string) => void,
): Promise<T> {
  const id = ++sequence;
  self.postMessage({ type: "rpc", id, method, payload } satisfies RpcRequest);
  return new Promise((resolve, reject) =>
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      onDelta,
    }),
  );
}

function emptyMessage(model: Model<string>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

async function stream(
  model: Model<string>,
  context: TranscriptContext,
  subagentId?: string,
) {
  const events = createAssistantMessageEventStream();
  void (async () => {
    const partial = emptyMessage(model);
    events.push({ type: "start", partial });
    try {
      const messages = context.messages
        .filter((message) => message.role !== "system")
        .map((message) => {
          if (message.role === "assistant")
            return {
              role: "assistant",
              text: message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join(""),
              tool_calls: message.content
                .filter((part) => part.type === "toolCall")
                .map((part) => ({
                  id: part.id,
                  name: part.name,
                  arguments: part.arguments,
                })),
            };
          if (message.role === "toolResult")
            return {
              role: "tool",
              text: message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join(""),
              tool_call_id: message.toolCallId,
              tool_name: message.toolName,
            };
          return {
            role: "user",
            text:
              typeof message.content === "string"
                ? message.content
                : message.content
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join(""),
          };
        });
      let streamText = "";
      const reply = await rpcStream<{
        tool_calls: Array<{
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        }>;
        usage: Record<string, number>;
      }>(
        "model-turn-stream",
        {
          model_id: model.id,
          run_id: activeRunId,
          subagent_id: subagentId,
          system: getCurrentSystemPrompt(context.messages),
          messages,
          tools: getCurrentTools(context.messages).map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters_schema: tool.parameters,
          })),
        },
        (delta) => {
          if (!streamText) {
            partial.content.push({ type: "text", text: "" });
            events.push({ type: "text_start", contentIndex: 0, partial });
          }
          streamText += delta;
          partial.content[0] = { type: "text", text: streamText };
          events.push({ type: "text_delta", contentIndex: 0, delta, partial });
          self.postMessage({ type: "delta", text: delta });
        },
      );
      if (streamText)
        events.push({
          type: "text_end",
          contentIndex: 0,
          content: streamText,
          partial,
        });
      for (const call of reply.tool_calls || []) {
        const index = partial.content.length;
        const toolCall = {
          type: "toolCall" as const,
          id: call.id,
          name: call.name,
          arguments: call.arguments as JsonObject,
        };
        partial.content.push(toolCall);
        events.push({ type: "toolcall_start", contentIndex: index, partial });
        events.push({
          type: "toolcall_end",
          contentIndex: index,
          toolCall,
          partial,
        });
      }
      partial.usage.input = reply.usage?.prompt_tokens || 0;
      partial.usage.output = reply.usage?.completion_tokens || 0;
      partial.usage.totalTokens = reply.usage?.total_tokens || 0;
      partial.stopReason = reply.tool_calls?.length ? "toolUse" : "stop";
      events.push({
        type: "done",
        reason: partial.stopReason,
        message: partial,
      });
    } catch (cause) {
      partial.stopReason = "error";
      partial.errorMessage =
        cause instanceof Error ? cause.message : "模型调用失败";
      events.push({ type: "error", reason: "error", error: partial });
    }
  })();
  return events;
}

const readTool: AgentTool = {
  name: "fpl_read",
  label: "读取应用数据",
  description:
    "读取当前 FPL Workspace 中已授权的项目和对象。只能使用 /v1 下的 GET 接口。",
  parameters: Type.Object({
    path: Type.String({ description: "FPL API path beginning with /v1/" }),
  }),
  async execute(_id, params) {
    const value = await rpc<unknown>("fpl-read", params);
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      details: undefined,
    };
  },
};

const operationCatalogTool: AgentTool = {
  name: "fpl_operations",
  label: "查找 FPL 业务操作",
  description:
    "按应用资源查找已登记的 FPL 业务操作及参数。resource 可用 video、visual、thought、galgame、presentation、annotation、director、files、generation、inference；省略时列出全部。",
  parameters: Type.Object({ resource: Type.Optional(Type.String()) }),
  async execute(_id, params) {
    const value = await rpc<unknown>("fpl-operations", params);
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      details: undefined,
    };
  },
};

const registeredReadTool: AgentTool = {
  name: "fpl_operation_read",
  label: "读取已登记业务操作",
  description:
    "执行 fpl_operations 返回的 GET 操作。只读取当前授权 Workspace。",
  parameters: Type.Object({
    operation: Type.String(),
    path_params: Type.Optional(Type.Record(Type.String(), Type.String())),
    query: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
  async execute(_id, params) {
    const value = await rpc<unknown>("fpl-operation-read", params);
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      details: undefined,
    };
  },
};

const registeredWriteTool: AgentTool = {
  name: "fpl_operation_write",
  label: "执行已登记业务操作",
  description:
    "执行 fpl_operations 返回的 POST/PATCH/PUT/DELETE 操作。body 应为 JSON 对象，不要序列化成字符串。必须使用当前资源版本，执行前展示完整参数并等待用户批准。",
  parameters: Type.Object({
    operation: Type.String(),
    path_params: Type.Optional(Type.Record(Type.String(), Type.String())),
    query: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    body: Type.Optional(Type.Unknown()),
  }),
  async execute(_id, params) {
    const { operation, ...arguments_ } = params as {
      operation: string;
      path_params?: Record<string, string>;
      query?: Record<string, unknown>;
      body?: unknown;
    };
    const value = await rpc<unknown>("invoke", {
      tool_call_id: _id,
      tool_name: `fpl_operation:${operation}`,
      arguments: {
        ...arguments_,
        ...(arguments_.body === undefined
          ? {}
          : { body: normalizeOperationBody(arguments_.body) }),
      },
    });
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      details: undefined,
    };
  },
  replay: "never",
  executionMode: "sequential",
};

const listFilesTool: AgentTool = {
  name: "list_work_files",
  label: "查看会话文件",
  description:
    "列出本次对话工作目录中的导入素材、脚本和输出，包含脚本 SHA256。",
  parameters: Type.Object({}),
  async execute() {
    const value = await rpc<unknown>("list-files", {});
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      details: undefined,
    };
  },
};

const readFileTool: AgentTool = {
  name: "read_work_file",
  label: "读取会话文件",
  description:
    "读取本次对话的文本导入素材、脚本或输出。大于 1 MiB 的文件不读取。",
  parameters: Type.Object({
    kind: Type.Union([
      Type.Literal("imports"),
      Type.Literal("scripts"),
      Type.Literal("outputs"),
    ]),
    name: Type.String(),
  }),
  async execute(_id, params) {
    const value = await rpc<unknown>("file-read", params);
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      details: undefined,
    };
  },
};

const readSkillFileTool: AgentTool = {
  name: "read_skill_file",
  label: "读取技能附属文件",
  description:
    "读取当前会话已加载 Skill 固定版本中的文本附属文件。只能读取已加载版本，且不执行其中的脚本。",
  parameters: Type.Object({
    skill_id: Type.String(),
    version: Type.String(),
    path: Type.String(),
  }),
  async execute(_id, params) {
    const value = await rpc<unknown>("skill-file-read", params);
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      details: undefined,
    };
  },
};

const askUserTool: AgentTool = {
  name: "ask_user",
  label: "向用户提问",
  description:
    "只在缺少关键选择时提一个问题。可提供最多五个选项，允许用户补充文字。任务会暂停，等待用户回答。",
  parameters: Type.Object({
    question: Type.String(),
    options: Type.Optional(Type.Array(Type.String(), { maxItems: 5 })),
    allow_text: Type.Optional(Type.Boolean()),
  }),
  async execute(id, params) {
    await rpc("ask-user", {
      tool_call_id: id,
      ...(params as Record<string, unknown>),
    });
    return {
      content: [{ type: "text", text: "等待用户回答" }],
      details: undefined,
    };
  },
  replay: "never",
  executionMode: "sequential",
};

const writeScriptTool: AgentTool = {
  name: "write_script",
  label: "创建会话脚本",
  description:
    "在本次对话 scripts 目录内创建 Python 脚本。修改已有文件时提供 list_work_files 返回的 expected_sha256。需要用户确认。",
  parameters: Type.Object({
    name: Type.String(),
    content: Type.String(),
    expected_sha256: Type.Optional(Type.String()),
  }),
  async execute(_id, params) {
    const value = await rpc<unknown>("invoke", {
      tool_call_id: _id,
      tool_name: "write_script",
      arguments: params,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      details: undefined,
    };
  },
  replay: "never",
  executionMode: "sequential",
};

const runScriptTool: AgentTool = {
  name: "run_script",
  label: "运行会话脚本",
  description:
    "在 macOS 沙箱中执行本次对话 scripts 目录的 Python 脚本或受限 shell。先用 list_work_files 获取 SHA256；shell 的 SHA256 应为命令文本的 SHA256。需要用户确认。",
  parameters: Type.Object({
    kind: Type.Union([Type.Literal("python"), Type.Literal("shell")]),
    name: Type.Optional(Type.String()),
    command: Type.Optional(Type.String()),
    sha256: Type.String(),
  }),
  async execute(_id, params) {
    const value = await rpc<unknown>("invoke", {
      tool_call_id: _id,
      tool_name: "run_script",
      arguments: params,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      details: undefined,
    };
  },
  replay: "never",
  executionMode: "sequential",
};

const videoTimelineTool: AgentTool = {
  name: "video_timeline_batch",
  label: "调整视频时间线",
  description:
    "对视频剪辑工坊项目提交一批时间线操作。先用 fpl_read 读取 /v1/video-editor/projects/{project_id}/timeline，使用当前 revision；仅在用户逐项确认后执行。",
  parameters: Type.Object({
    project_id: Type.String(),
    expected_revision: Type.Integer({ minimum: 0 }),
    operations: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
      minItems: 1,
      maxItems: 200,
    }),
  }),
  async execute(_id, params) {
    const value = await rpc<unknown>("invoke", {
      tool_call_id: _id,
      tool_name: "video_timeline_batch",
      arguments: params,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      details: undefined,
    };
  },
  replay: "never",
  executionMode: "sequential",
};

self.onmessage = (
  event: MessageEvent<Start | RpcReply | RpcDelta | { type: "stop" }>,
) => {
  const input = event.data;
  if (input.type === "rpc-delta") {
    pending.get(input.id)?.onDelta?.(input.text);
    return;
  }
  if (input.type === "rpc-result") {
    const entry = pending.get(input.id);
    pending.delete(input.id);
    if (input.error) entry?.reject(new Error(input.error));
    else entry?.resolve(input.value);
    return;
  }
  if (input.type === "stop") {
    stopRequested = true;
    for (const entry of pending.values()) entry.reject(new Error("任务已停止"));
    pending.clear();
    agent?.abort();
    return;
  }
  if (input.type !== "start") return;
  agent?.abort();
  stopRequested = false;
  activeRunId = input.runId;
  const model: Model<string> = {
    id: input.modelId,
    name: input.modelId,
    api: "fpl-amadeus",
    provider: "fpl",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  };
  const messages: Message[] = input.history.map((item) => {
    if (item.role === "tool")
      return {
        role: "toolResult",
        toolCallId: item.tool_call_id || "unknown",
        toolName: item.tool_name || "tool",
        content: [{ type: "text", text: item.content }],
        isError: false,
        timestamp: Date.now(),
      };
    if (item.role === "assistant")
      return {
        role: "assistant",
        content: [
          ...(item.content
            ? [{ type: "text" as const, text: item.content }]
            : []),
          ...(item.tool_calls || []).map((call) => ({
            type: "toolCall" as const,
            id: call.id,
            name: call.name,
            arguments: call.arguments as JsonObject,
          })),
        ],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: emptyMessage(model).usage,
        stopReason: item.tool_calls?.length ? "toolUse" : "stop",
        timestamp: Date.now(),
      };
    return { role: "user", content: item.content, timestamp: Date.now() };
  }) as Message[];
  const loadedTools: AgentTool[] = input.tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: Type.Unsafe(tool.schema),
    async execute(_id, params) {
      const result = await rpc<unknown>("invoke", {
        tool_call_id: _id,
        tool_name: tool.key,
        arguments: params,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: undefined,
      };
    },
    replay: "never",
    executionMode: "sequential",
  }));
  const readOnlyTools: AgentTool[] = [
    readTool,
    operationCatalogTool,
    registeredReadTool,
    listFilesTool,
    readFileTool,
    readSkillFileTool,
  ];
  const delegateTool: AgentTool = {
    name: "delegate_readonly",
    label: "并行只读调查",
    description:
      "仅在有两个相互独立的调查任务时并行委派。子任务只能读取，不能提问、审批或修改数据；简单任务请自己完成。",
    parameters: Type.Object({
      tasks: Type.Array(Type.String(), { minItems: 2, maxItems: 2 }),
    }),
    async execute(_id, params) {
      const tasks = (params as { tasks: string[] }).tasks;
      const findings = await Promise.all(
        tasks.map(async (task, index) => {
          const childId = `${_id}:${index + 1}`;
          self.postMessage({
            type: "subagent",
            status: "running",
            id: childId,
            name: task,
          });
          const child = new Agent({
            initialState: {
              model,
              messages: [],
              systemPrompt:
                "你是 Amadeus 的只读子任务。只能使用提供的读取工具；简要报告查到的事实和依据，不作修改，不向用户提问。",
              tools: readOnlyTools,
            },
            streamFn: (childModel, context) =>
              stream(childModel, context, childId),
            toolExecution: "sequential",
          });
          const timeout = setTimeout(() => child.abort(), 90_000);
          try {
            await child.prompt(
              `${task}\n\n[原任务与窗口上下文] ${input.prompt}`,
            );
            const reply = [...child.state.messages]
              .reverse()
              .find((item) => item.role === "assistant");
            const summary =
              reply?.role === "assistant"
                ? reply.content
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("")
                    .slice(0, 4000)
                : "未取得调查结果";
            self.postMessage({
              type: "subagent",
              status: child.state.errorMessage ? "failed" : "done",
              id: childId,
              name: task,
              result: summary,
            });
            return { task, summary };
          } catch (cause) {
            const summary =
              cause instanceof Error ? cause.message : "调查未完成";
            self.postMessage({
              type: "subagent",
              status: "failed",
              id: childId,
              name: task,
              result: summary,
            });
            return { task, summary };
          } finally {
            clearTimeout(timeout);
          }
        }),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(findings) }],
        details: undefined,
      };
    },
    replay: "never",
    executionMode: "sequential",
  };
  agent = new Agent({
    initialState: {
      model,
      messages,
      systemPrompt:
        (input.mode === "plan"
          ? "你是 Future Props Lab 的 Amadeus，当前处于 Plan 模式。只读取当前授权 Workspace 的信息，给出简短、可执行的计划，不修改项目。需要关键选择时使用 ask_user。不要假设界面状态。\n"
          : "你是 Future Props Lab 的 Amadeus，当前处于 Agent 模式。只根据当前授权 Workspace 的上下文操作。先读取，修改前等待用户确认。简单任务自己完成；只有两个独立调查任务时才使用只读委派。不要假设界面状态。\n") +
        input.skills
          .map(
            (skill) =>
              `<skill name="${skill.name}">\n${skill.content}\n</skill>`,
          )
          .join("\n"),
      tools:
        input.mode === "plan"
          ? [...readOnlyTools, askUserTool]
          : [
              ...readOnlyTools,
              askUserTool,
              delegateTool,
              registeredWriteTool,
              videoTimelineTool,
              writeScriptTool,
              runScriptTool,
              ...loadedTools,
            ],
    },
    streamFn: (currentModel, context) => stream(currentModel, context),
    toolExecution: "sequential",
  });
  agent.subscribe((output) => {
    if (output.type === "message_end" && output.message.role === "assistant") {
      self.postMessage({
        type: "message",
        text: output.message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
      });
    }
    if (output.type === "tool_execution_start")
      self.postMessage({
        type: "tool",
        id: output.toolCallId,
        name: output.toolName,
        arguments: output.args,
        status: "running",
      });
    if (output.type === "tool_execution_end")
      self.postMessage({
        type: "tool",
        id: output.toolCallId,
        name: output.toolName,
        status: output.isError ? "failed" : "done",
        result: output.result,
      });
  });
  void agent.prompt(input.prompt).then(
    () => {
      if (stopRequested) self.postMessage({ type: "stopped" });
      else if (agent?.state.errorMessage)
        self.postMessage({ type: "error", message: agent.state.errorMessage });
      else self.postMessage({ type: "done" });
    },
    (error: unknown) => {
      if (stopRequested) self.postMessage({ type: "stopped" });
      else
        self.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
    },
  );
};
