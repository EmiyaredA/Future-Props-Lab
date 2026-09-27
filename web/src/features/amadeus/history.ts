import type {
  ChatMessage,
  RunDetail,
  SavedAction,
  SavedQuestion,
} from "./protocol";

export type AgentHistoryItem = {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tool_call_id?: string;
  tool_name?: string;
};

export type TimelineItem =
  | { kind: "message"; at: string; sequence: number; message: ChatMessage }
  | {
      kind: "tool";
      at: string;
      sequence: number;
      runId: string;
      callId: string;
      name: string;
      arguments: Record<string, unknown>;
      result?: unknown;
      action?: SavedAction;
      children: Array<{
        id: string;
        task: string;
        status: string;
        result?: unknown;
      }>;
    }
  | { kind: "question"; at: string; sequence: number; question: SavedQuestion };

export function conversationTimeline(
  messages: ChatMessage[],
  runs: RunDetail[],
  actions: SavedAction[],
  questions: SavedQuestion[],
): TimelineItem[] {
  const eventMessageRuns = new Set(
    runs
      .filter((run) =>
        run.events.some((event) => event.kind === "assistant_message"),
      )
      .map((run) => run.run.id),
  );
  const items: TimelineItem[] = messages
    .filter(
      (message) => !message.run_id || !eventMessageRuns.has(message.run_id),
    )
    .map((message) => ({
      kind: "message",
      at: message.created_at,
      sequence: 0,
      message,
    }));
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const actionByRun = new Map(
    actions
      .filter((action) => action.run_id)
      .map((action) => [action.run_id, action]),
  );
  const questionCalls = new Set(
    questions.map((question) => question.tool_call_id),
  );
  const calls = new Map<string, Extract<TimelineItem, { kind: "tool" }>>();
  for (const run of runs) {
    const fallbackTime = new Date(
      new Date(
        messages.find((message) => message.run_id === run.run.id)?.created_at ||
          Date.now(),
      ).getTime() - 1,
    ).toISOString();
    for (const event of run.events) {
      const payload = event.payload;
      const callId = String(payload.tool_call_id || "");
      if (event.kind === "assistant_message" && payload.text) {
        items.push({
          kind: "message",
          at: event.created_at || fallbackTime,
          sequence: event.sequence,
          message: {
            id: `event:${run.run.id}:${event.sequence}`,
            role: "assistant",
            content: String(payload.text),
            references: [],
            run_id: run.run.id,
            created_at: event.created_at || fallbackTime,
          },
        });
      } else if (
        event.kind === "tool_call" &&
        callId &&
        !questionCalls.has(callId)
      ) {
        const name = String(payload.tool_name || "工具");
        const runAction = actionByRun.get(run.run.id);
        const item: Extract<TimelineItem, { kind: "tool" }> = {
          kind: "tool",
          at: event.created_at || fallbackTime,
          sequence: event.sequence,
          runId: run.run.id,
          callId,
          name,
          arguments:
            payload.arguments && typeof payload.arguments === "object"
              ? (payload.arguments as Record<string, unknown>)
              : {},
          action:
            actionById.get(String(payload.action_id || "")) ||
            (runAction &&
            (runAction.tool_name === name ||
              name === "fpl_operation_write" ||
              name.startsWith("amadeus_api_") ||
              name.startsWith("amadeus_mcp_"))
              ? runAction
              : undefined),
          children: [],
        };
        items.push(item);
        calls.set(`${run.run.id}:${callId}`, item);
      } else if (event.kind === "tool_result") {
        const item = calls.get(`${run.run.id}:${callId}`);
        if (item) item.result = payload.result;
      } else if (event.kind === "subagent_start") {
        const parent = [...calls.values()]
          .reverse()
          .find(
            (item) =>
              item.runId === run.run.id && item.name === "delegate_readonly",
          );
        parent?.children.push({
          id: String(payload.id),
          task: String(payload.task),
          status: "running",
        });
      } else if (event.kind === "subagent_finish") {
        const child = [...calls.values()]
          .flatMap((item) => item.children)
          .find((item) => item.id === String(payload.id));
        if (child) {
          child.status = String(payload.status);
          child.result = payload.result;
        }
      }
    }
  }
  for (const question of questions)
    items.push({
      kind: "question",
      at: question.created_at,
      sequence: 0,
      question,
    });
  const linkedActions = new Set(
    items.filter((item) => item.kind === "tool").map((item) => item.action?.id),
  );
  for (const action of actions) {
    if (linkedActions.has(action.id)) continue;
    items.push({
      kind: "tool",
      at: action.created_at,
      sequence: 0,
      runId: action.run_id || `legacy:${action.id}`,
      callId: `action:${action.id}`,
      name: action.tool_name,
      arguments: action.arguments,
      action,
      children: [],
    });
  }
  return items.sort(
    (a, b) =>
      (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) ||
      a.sequence - b.sequence,
  );
}

export function buildAgentHistory(
  messages: ChatMessage[],
  runs: RunDetail[],
  actions: SavedAction[] = [],
  questions: SavedQuestion[] = [],
): AgentHistoryItem[] {
  const transcript: AgentHistoryItem[] = [];
  for (const item of conversationTimeline(messages, runs, actions, questions)) {
    if (item.kind === "message") {
      const message = item.message;
      transcript.push({
        role: message.role === "assistant" ? "assistant" : "user",
        content:
          message.content +
          (message.references?.length
            ? `\n[当时引用] ${message.references.map((ref) => `${ref.application}/${ref.name}: ${ref.value}`).join("; ")}`
            : ""),
      });
    } else if (item.kind === "question") {
      const question = item.question;
      transcript.push({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: question.tool_call_id,
            name: "ask_user",
            arguments: {
              question: question.prompt,
              options: question.options,
              allow_text: question.allow_text,
            },
          },
        ],
      });
      if (question.status === "answered")
        transcript.push({
          role: "tool",
          content: JSON.stringify(question.answer),
          tool_call_id: question.tool_call_id,
          tool_name: "ask_user",
        });
    } else {
      transcript.push({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: item.callId, name: item.name, arguments: item.arguments },
        ],
      });
      const action = item.action;
      const result =
        action &&
        !["pending", "approved", "running", "unknown"].includes(action.status)
          ? action.status === "rejected"
            ? { rejected: true, message: "用户拒绝执行" }
            : { status: action.status, result: action.result }
          : item.result;
      if (result !== undefined)
        transcript.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: item.callId,
          tool_name: item.name,
        });
    }
  }
  return transcript;
}
