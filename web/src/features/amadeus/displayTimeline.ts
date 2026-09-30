import { conversationTimeline, type TimelineItem } from "./history";
import type { Detail, RunDetail } from "./protocol";

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
  | Extract<TimelineItem, { kind: "message" | "question" }>
  | { kind: "artifact"; at: string; sequence: number; artifact: ArtifactStep }
  | { kind: "action"; at: string; sequence: number; tool: ToolStep }
  | {
      kind: "milestone";
      at: string;
      sequence: number;
      runId: string;
      count: number;
      status: string;
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

export function buildDisplayTimeline(detail: Detail, runs: RunDetail[]) {
  const timeline = conversationTimeline(
    detail.messages,
    runs,
    detail.actions || [],
    detail.questions || [],
  );
  const entries: DisplayItem[] = [];
  const tools: ToolStep[] = [];
  const runStatus = new Map(runs.map((run) => [run.run.id, run.run.status]));
  const readByRun = new Map<
    string,
    { first: ToolStep; count: number; failed: boolean }
  >();
  for (const item of timeline) {
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
      const current = readByRun.get(item.runId);
      if (current) {
        current.count += 1;
        current.failed ||= [
          "failed",
          "interrupted",
          "cancelled",
          "unknown",
        ].includes(displayStatus);
      } else {
        readByRun.set(item.runId, {
          first: tool,
          count: 1,
          failed: ["failed", "interrupted", "cancelled", "unknown"].includes(
            displayStatus,
          ),
        });
      }
    }
  }
  for (const [runId, group] of readByRun)
    entries.push({
      kind: "milestone",
      at: group.first.at,
      sequence: group.first.sequence,
      runId,
      count: group.count,
      status: group.failed
        ? "failed"
        : tools.some(
              (tool) =>
                tool.runId === runId &&
                !tool.action &&
                tool.displayStatus === "running",
            )
          ? "running"
          : "completed",
    });
  entries.sort(
    (a, b) =>
      (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) ||
      a.sequence - b.sequence,
  );
  return { entries, tools };
}
