import {
  compareTimelinePosition,
  conversationTimeline,
  type TimelineItem,
} from "./history";
import type { ChatMessage, Detail, Run, RunDetail } from "./protocol";

export type ToolStep = Extract<TimelineItem, { kind: "tool" }> & {
  displayStatus: string;
};

export type ArtifactStep = {
  kind: "plan" | "draft";
  title: string;
  body: string;
  steps: Array<{ title: string; detail: string }>;
  runId: string;
  callId: string;
};

export type DisplayItem =
  | Extract<TimelineItem, { kind: "message" | "question" | "reasoning" }>
  | {
      kind: "run_error";
      at: string;
      sequence: number;
      runId: string;
      id: string;
      text: string;
    }
  | { kind: "run_summary"; at: string; sequence: number; run: Run }
  | { kind: "artifact"; at: string; sequence: number; artifact: ArtifactStep }
  | { kind: "action"; at: string; sequence: number; tool: ToolStep }
  | {
      kind: "milestone";
      at: string;
      sequence: number;
      runId: string;
      count: number;
      status: string;
      steps: ToolStep[];
    };

function artifactFromTool(item: ToolStep): ArtifactStep | null {
  if (item.name !== "present_artifact" || item.displayStatus !== "completed")
    return null;
  const value = item.arguments;
  if (
    (value.kind !== "plan" && value.kind !== "draft") ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    !value.title.trim() ||
    !value.body.trim()
  )
    return null;
  const steps = Array.isArray(value.steps)
    ? value.steps.filter(
        (step): step is { title: string; detail: string } =>
          !!step &&
          typeof step === "object" &&
          typeof step.title === "string" &&
          typeof step.detail === "string",
      )
    : [];
  if (value.kind === "plan" && !steps.length) return null;
  return {
    kind: value.kind,
    title: value.title,
    body: value.body,
    steps,
    runId: item.runId,
    callId: item.callId,
  };
}

type Reply = Extract<TimelineItem, { kind: "message" }>;
const terminalStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "waiting_approval",
  "waiting_question",
]);
const replyBoundaries = new Set([
  "tool_call",
  "reasoning_summary",
  "question",
  "error",
]);

function eventReplies({ run, events }: RunDetail, fallbackTime: string) {
  const replies: Reply[] = [];
  const deltas: string[] = [];
  let current: Reply | undefined;
  for (const event of events) {
    if (replyBoundaries.has(event.kind)) current = undefined;
    const eventText = event.payload.text;
    if (
      (event.kind !== "assistant_delta" &&
        event.kind !== "assistant_message") ||
      typeof eventText !== "string" ||
      !eventText
    )
      continue;
    let text = eventText;
    const delta = event.kind === "assistant_delta";
    if (delta) deltas.push(text);
    if (current && (delta || text.startsWith(current.message.content))) {
      current.message.content = delta ? current.message.content + text : text;
      if (!delta) current = undefined;
      continue;
    }
    // Some executors also report the whole response as a final snapshot.
    if (!delta && replies.length) {
      const prefix = replies.map((reply) => reply.message.content).join("");
      if (text.startsWith(prefix)) {
        const suffix = text.slice(prefix.length);
        if (current) {
          current.message.content += suffix;
          current = undefined;
          continue;
        }
        if (!suffix) continue;
        text = suffix;
      }
    }
    const at = event.created_at || fallbackTime;
    const reply: Reply = {
      kind: "message",
      at,
      sequence: event.sequence,
      message: {
        id: `chunk:${run.id}:${event.sequence}`,
        role: "assistant",
        content: text,
        references: [],
        created_at: at,
        run_id: run.id,
      },
    };
    replies.push(reply);
    current = delta ? reply : undefined;
  }
  if (current) current.streaming = !terminalStatuses.has(run.status);
  return {
    replies,
    text: replies.map((reply) => reply.message.content).join(""),
    deltaText: deltas.join(""),
  };
}

function chronologicalRun(record: RunDetail, fallbackTime: string) {
  let last = Date.parse(record.run.created_at || fallbackTime);
  const events = [
    ...new Map(record.events.map((event) => [event.sequence, event])).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  return {
    ...record,
    events: events.map((event) => {
      const timestamp = Date.parse(event.created_at || "");
      if (Number.isFinite(timestamp))
        last = Number.isFinite(last) ? Math.max(last, timestamp) : timestamp;
      return {
        ...event,
        created_at: Number.isFinite(last)
          ? new Date(last).toISOString()
          : fallbackTime,
      };
    }),
  };
}

function timelineRunId(
  item:
    TimelineItem | Extract<DisplayItem, { kind: "run_error" | "run_summary" }>,
) {
  if (item.kind === "message") return item.message.run_id;
  if (item.kind === "question") return item.question.run_id;
  if (item.kind === "run_summary") return item.run.id;
  return item.runId;
}

export function buildDisplayTimeline(detail: Detail, runs: RunDetail[]) {
  const savedReplies = new Map<string, ChatMessage[]>();
  for (const message of detail.messages) {
    if (message.role !== "assistant" || !message.run_id) continue;
    const saved = savedReplies.get(message.run_id);
    if (saved) saved.push(message);
    else savedReplies.set(message.run_id, [message]);
  }
  const replies = new Map<string, Reply[]>();
  const summaries: Extract<
    DisplayItem,
    { kind: "run_summary" | "run_error" }
  >[] = [];
  const orderedRuns = runs.map((record) => {
    const start =
      detail.messages.find(
        (message) =>
          message.run_id === record.run.id && message.role === "user",
      )?.created_at ||
      record.events.reduce<string | undefined>((first, event) => {
        const at = event.created_at;
        return at && (!first || Date.parse(at) < Date.parse(first))
          ? at
          : first;
      }, undefined) ||
      record.run.updated_at ||
      detail.conversation.created_at;
    return chronologicalRun(record, start);
  });
  const runOrder = new Map(
    orderedRuns.map(({ run }, index) => [run.id, index + 1]),
  );
  for (const record of orderedRuns) {
    const { run, events } = record;
    const saved = savedReplies.get(run.id) ?? [];
    const fallbackTime =
      saved[0]?.created_at || run.updated_at || detail.conversation.updated_at;
    const rendered = eventReplies(record, fallbackTime);
    let repeatedError = false;
    for (const event of events) {
      const message = event.payload.message ?? event.payload.text;
      if (
        event.kind !== "error" ||
        typeof message !== "string" ||
        !message.trim()
      )
        continue;
      repeatedError ||= message === run.error_message;
      summaries.push({
        kind: "run_error",
        runId: run.id,
        id: `${run.id}:${event.sequence}`,
        at: event.created_at || fallbackTime,
        sequence: event.sequence,
        text: message,
      });
    }
    const lastEventAt = events.at(-1)?.created_at;
    if (terminalStatuses.has(run.status) || run.usage) {
      const finishedAt =
        run.finished_at || run.updated_at || lastEventAt || fallbackTime;
      summaries.push({
        kind: "run_summary",
        at:
          lastEventAt && Date.parse(lastEventAt) > Date.parse(finishedAt)
            ? lastEventAt
            : finishedAt,
        sequence: Number.MAX_SAFE_INTEGER,
        run: repeatedError ? { ...run, error_message: null } : run,
      });
    }
    // Historical plan runs without a structured artifact still use the full reply
    // as the editable plan. Live text and structured plans can use event chunks.
    const legacyPlan =
      run.mode === "plan" &&
      run.status === "completed" &&
      !events.some(
        (event) =>
          event.kind === "tool_call" &&
          event.payload.tool_name === "present_artifact",
      );
    const savedIsCovered =
      saved.length === 1 &&
      (saved[0].content === rendered.text ||
        saved[0].content ===
          rendered.replies.map((reply) => reply.message.content).join("\n\n") ||
        (rendered.deltaText && saved[0].content === rendered.deltaText));
    const partialIsCovered =
      !run.partial_text ||
      run.partial_text === rendered.deltaText ||
      run.partial_text === rendered.text;
    if (
      !legacyPlan &&
      rendered.replies.length &&
      (saved.length ? savedIsCovered : partialIsCovered)
    ) {
      const lastReply = rendered.replies.at(-1);
      if (lastReply && saved[0]?.references.length)
        lastReply.message.references = saved[0].references;
      replies.set(run.id, rendered.replies);
      continue;
    }
    // An empty override keeps saved messages and suppresses event message rows.
    replies.set(run.id, []);
    const content =
      legacyPlan && partialIsCovered
        ? rendered.text || run.partial_text
        : run.partial_text;
    if (saved.length || !content) continue;
    const at = lastEventAt || fallbackTime;
    replies.set(run.id, [
      {
        kind: "message",
        at,
        sequence: Number.MAX_SAFE_INTEGER - 1,
        streaming: !terminalStatuses.has(run.status),
        message: {
          id: `stream:${run.id}`,
          role: "assistant",
          content,
          references: [],
          created_at: at,
          run_id: run.id,
        },
      },
    ]);
  }
  const timeline = conversationTimeline(
    detail.messages,
    orderedRuns,
    detail.actions || [],
    detail.questions || [],
    replies,
  );
  const ordered = [...timeline, ...summaries].sort((a, b) => {
    const timestamp = compareTimelinePosition(
      { ...a, sequence: 0 },
      { ...b, sequence: 0 },
    );
    return (
      timestamp ||
      (runOrder.get(timelineRunId(a) ?? "") ?? 0) -
        (runOrder.get(timelineRunId(b) ?? "") ?? 0) ||
      a.sequence - b.sequence
    );
  });
  const entries: DisplayItem[] = [];
  const tools: ToolStep[] = [];
  const runStatus = new Map(runs.map((run) => [run.run.id, run.run.status]));
  // Happier groups consecutive ordinary tool calls. Interactive cards break a group.
  for (const item of ordered) {
    if (item.kind !== "tool") {
      entries.push(item);
      continue;
    }
    const terminalRunStatus = runStatus.get(item.runId);
    const displayStatus =
      item.action?.status ||
      (item.eventStatus === "failed"
        ? "failed"
        : item.eventStatus === "done"
          ? "completed"
          : item.result === undefined
            ? terminalRunStatus === "interrupted" ||
              terminalRunStatus === "cancelled" ||
              terminalRunStatus === "failed"
              ? terminalRunStatus
              : terminalRunStatus === "completed"
                ? "unknown"
                : "running"
            : "completed");
    const tool: ToolStep = { ...item, displayStatus };
    if (item.name === "present_artifact") {
      const artifact = artifactFromTool(tool);
      if (artifact)
        entries.push({
          kind: "artifact",
          at: item.at,
          sequence: item.sequence,
          artifact,
        });
      continue;
    }
    tools.push(tool);
    if (item.action) {
      entries.push({
        kind: "action",
        at: item.at,
        sequence: item.sequence,
        tool,
      });
    } else {
      const status = ["failed", "interrupted", "cancelled", "unknown"].includes(
        displayStatus,
      )
        ? "failed"
        : displayStatus === "running"
          ? "running"
          : "completed";
      const group = entries.at(-1);
      if (group?.kind === "milestone" && group.runId === item.runId) {
        group.steps.push(tool);
        group.count++;
        if (status === "failed" || group.status === "completed")
          group.status = status;
      } else
        entries.push({
          kind: "milestone",
          at: item.at,
          sequence: item.sequence,
          runId: item.runId,
          count: 1,
          status,
          steps: [tool],
        });
    }
  }
  return { entries, tools };
}
