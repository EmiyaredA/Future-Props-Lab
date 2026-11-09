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
  | {
      kind: "message";
      at: string;
      sequence: number;
      message: ChatMessage;
      streaming?: boolean;
    }
  | {
      kind: "reasoning";
      at: string;
      sequence: number;
      runId: string;
      text: string;
    }
  | {
      kind: "tool";
      at: string;
      sequence: number;
      runId: string;
      callId: string;
      name: string;
      arguments: Record<string, unknown>;
      result?: unknown;
      eventStatus?: string;
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
  replies: ReadonlyMap<
    string,
    Extract<TimelineItem, { kind: "message" }>[]
  > = new Map(),
): TimelineItem[] {
  const eventMessageRuns = new Set(
    runs
      .filter(
        (run) =>
          !replies.has(run.run.id) &&
          run.events.some(
            (event) => event.kind === "assistant_message" && event.payload.text,
          ),
      )
      .map((run) => run.run.id),
  );
  const items: TimelineItem[] = messages
    .filter(
      (message) =>
        message.role !== "assistant" ||
        !message.run_id ||
        (!eventMessageRuns.has(message.run_id) &&
          !replies.get(message.run_id)?.length),
    )
    .map((message) => ({
      kind: "message",
      at: message.created_at,
      sequence: 0,
      message,
    }));
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const questionByCall = new Map(
    questions.map((question) => [
      `${question.run_id}:${question.tool_call_id}`,
      question,
    ]),
  );
  const placedQuestions = new Set<string>();
  const calls = new Map<string, Extract<TimelineItem, { kind: "tool" }>>();
  for (const run of runs) {
    items.push(...(replies.get(run.run.id) ?? []));
    const toolCalls = run.events
      .filter(
        (event) => event.kind === "tool_call" && event.payload.tool_call_id,
      )
      .sort((a, b) => b.sequence - a.sequence);
    const inferredActions = new Map<number, SavedAction>();
    const explicitActionIds = new Set(
      toolCalls.map(({ payload }) => payload.action_id),
    );
    for (const action of actions) {
      if (action.run_id !== run.run.id || explicitActionIds.has(action.id))
        continue;
      const call = toolCalls.find(({ sequence, payload }) => {
        if (payload.action_id || inferredActions.has(sequence)) return false;
        const name = payload.tool_name;
        const args = payload.arguments as Record<string, unknown> | undefined;
        return (
          name === action.tool_name ||
          (typeof args?.operation === "string" &&
            action.tool_name === `fpl_operation:${args.operation}`) ||
          (typeof args?.id === "string" &&
            ((args.id.startsWith("toolapi:") &&
              action.tool_name === `tool_api:${args.id.slice(8)}`) ||
              (args.id.startsWith("mcp:") &&
                action.tool_name === `${args.id}:${args.tool}`))) ||
          (name === "write_file" && action.tool_name === "write_work_file")
        );
      });
      if (call) inferredActions.set(call.sequence, action);
    }
    const inferredQuestions = new Map<number, SavedQuestion>();
    for (const question of questions) {
      if (
        question.run_id !== run.run.id ||
        toolCalls.some(
          ({ payload }) => payload.tool_call_id === question.tool_call_id,
        )
      )
        continue;
      const call = toolCalls.find(
        ({ sequence, payload }) =>
          payload.tool_name === "ask_user" &&
          (payload.arguments as Record<string, unknown> | undefined)?.prompt ===
            question.prompt &&
          !inferredQuestions.has(sequence),
      );
      if (call) inferredQuestions.set(call.sequence, question);
    }
    const fallbackTime = new Date(
      new Date(
        messages.find((message) => message.run_id === run.run.id)?.created_at ||
          Date.now(),
      ).getTime() - 1,
    ).toISOString();
    for (const event of run.events) {
      const payload = event.payload;
      const callId = String(payload.tool_call_id || "");
      const question =
        questionByCall.get(`${run.run.id}:${callId}`) ??
        inferredQuestions.get(event.sequence);
      if (event.kind === "tool_call" && question) {
        if (!placedQuestions.has(question.id)) {
          items.push({
            kind: "question",
            at: event.created_at || fallbackTime,
            sequence: event.sequence,
            question,
          });
          placedQuestions.add(question.id);
        }
      } else if (
        event.kind === "assistant_message" &&
        payload.text &&
        !replies.has(run.run.id)
      ) {
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
        event.kind === "reasoning_summary" &&
        typeof payload.text === "string" &&
        payload.text.trim()
      ) {
        items.push({
          kind: "reasoning",
          at: event.created_at || fallbackTime,
          sequence: event.sequence,
          runId: run.run.id,
          text: payload.text,
        });
      } else if (event.kind === "tool_call" && callId) {
        const name = String(payload.tool_name || "工具");
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
            inferredActions.get(event.sequence),
          children: [],
        };
        items.push(item);
        calls.set(`${run.run.id}:${callId}`, item);
      } else if (event.kind === "tool_result") {
        const item = calls.get(`${run.run.id}:${callId}`);
        if (item) {
          item.result = payload.result;
          item.eventStatus = String(payload.status || "done");
        }
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
  for (const question of questions) {
    if (placedQuestions.has(question.id)) continue;
    items.push({
      kind: "question",
      at: question.created_at,
      sequence: 0,
      question,
    });
  }
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
  return items.sort(compareTimelinePosition);
}

export function compareTimelinePosition(
  a: Pick<TimelineItem, "at" | "sequence">,
  b: Pick<TimelineItem, "at" | "sequence">,
) {
  return (
    (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || a.sequence - b.sequence
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
    } else if (item.kind === "tool") {
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
