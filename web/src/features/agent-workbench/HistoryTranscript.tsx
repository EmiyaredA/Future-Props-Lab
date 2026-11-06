import { useState } from "react";
import type { Conversation, HistoryEntry } from "./api";
import { ToolCodeBlock } from "./ToolCodeBlock";
import { toolCode } from "./toolCode";
import { commandFiles, type FileReference } from "./fileReferences";
import {
  TranscriptActivity,
  TranscriptMessage,
  TranscriptText,
} from "./TranscriptMessage";

import {
  ActivityDuration,
  ActivityRow,
  type ActivityDetails,
} from "./ActivityRow";

type Line = {
  id: string;
  text: string;
  kind: string;
  toolName?: string;
  callId?: string | null;
  status?: string | null;
  details?: ActivityDetails | null;
  attachments?: HistoryEntry["attachments"];
};

type Reply = {
  id: string;
  role: "user" | "assistant" | "system";
  timestamp: string;
  messageId: string;
  turnId?: string | null;
  lines: Line[];
};

function historyReplies(
  entries: HistoryEntry[],
  agent: Conversation["agent_id"],
) {
  const replies: Reply[] = [];
  for (const entry of entries) {
    const codexUserMessage =
      agent === "codex" && entry.kind === "message" && entry.role === "user";
    if (codexUserMessage && !entry.text && !entry.attachments?.length) continue;
    const presentation = entry.presentation;
    const messageId =
      presentation?.message_id ??
      (agent === "codex" || agent === "claude-code"
        ? entry.native_id.replace(/:\d+$/, "")
        : entry.native_id);
    const previous = replies.at(-1);
    const turnId = presentation?.turn_id;
    const role =
      entry.kind === "message" &&
      entry.role === "user" &&
      (codexUserMessage ||
        !(
          turnId &&
          previous?.role === "assistant" &&
          previous.turnId === turnId
        ))
        ? "user"
        : ["message", "compaction", "branch_summary"].includes(entry.kind) &&
            !["assistant", "user"].includes(entry.role)
          ? "system"
          : "assistant";
    const joins =
      previous &&
      previous.role === role &&
      (role === "user"
        ? previous.messageId === messageId
        : role === "assistant" &&
          !(turnId && previous.turnId && turnId !== previous.turnId));
    const reply: Reply = joins
      ? previous
      : {
          id: entry.id,
          role,
          messageId,
          turnId,
          timestamp: entry.timestamp,
          lines: [],
        };
    reply.turnId ??= turnId;
    if (!joins) replies.push(reply);
    const blocks = presentation?.blocks;
    if (blocks?.length) {
      blocks.forEach((block, index) =>
        reply.lines.push({
          id: index ? `${entry.id}:${index}` : entry.id,
          text: block.text,
          kind: block.kind,
          toolName: block.tool_name,
          callId: block.call_id,
          status: block.status,
          details: block.details,
          attachments:
            index === blocks.length - 1 ? entry.attachments : undefined,
        }),
      );
    } else {
      const legacyCodexCall =
        agent === "codex" && /^(call|result):/.test(entry.native_id)
          ? entry.native_id.replace(/^(call|result):/, "")
          : undefined;
      reply.lines.push({
        id: entry.id,
        text: entry.text,
        kind: entry.kind,
        toolName:
          agent === "claude-code" && entry.kind === "tool_result"
            ? ""
            : entry.tool_name,
        callId: presentation?.call_id ?? legacyCodexCall,
        status: presentation?.status,
        details: presentation?.details,
        attachments: entry.attachments,
      });
    }
  }
  return replies;
}

type Operation = { line: Line; results: Line[] };
type Section =
  { kind: "text"; line: Line } | { kind: "activity"; operations: Operation[] };
const toolKinds = ["tool_call", "tool_result", "thinking"];

function replySections(lines: Line[]) {
  const sections: Section[] = [];
  const calls = new Map<string, Operation | null>();
  const seenCalls = new Set<string>();
  for (const line of lines) {
    if (line.kind === "tool_call" && line.callId) {
      if (seenCalls.has(line.callId)) calls.set(line.callId, null);
      seenCalls.add(line.callId);
    }
  }
  for (const line of lines) {
    if (!toolKinds.includes(line.kind)) {
      sections.push({ kind: "text", line });
      continue;
    }
    const call = line.callId ? calls.get(line.callId) : undefined;
    if (line.kind === "tool_result" && call) {
      call.results.push(line);
      continue;
    }
    const operation: Operation = { line, results: [] };
    if (
      line.kind === "tool_call" &&
      line.callId &&
      calls.get(line.callId) !== null
    )
      calls.set(line.callId, operation);
    const tail = sections.at(-1);
    if (tail?.kind === "activity") tail.operations.push(operation);
    else sections.push({ kind: "activity", operations: [operation] });
  }
  return sections;
}

function operationDetails({ line, results }: Operation) {
  const details = line.details;
  if (details?.kind === "question" && line.kind === "tool_call") {
    const answers = [
      ...new Set([
        ...(details.answers ?? []),
        ...results.flatMap((result) => result.details?.answers ?? []),
      ]),
    ];
    return answers.length || details.questions?.length
      ? { ...details, answers }
      : null;
  }
  const duration =
    details?.duration_ms ??
    results.find((item) => item.details?.duration_ms)?.details?.duration_ms;
  if (details?.kind !== "question" && details)
    return { ...details, duration_ms: duration };
  return duration ? { kind: "duration" as const, duration_ms: duration } : null;
}

export function HistoryTranscript({
  messages,
  item,
  onOpenFile,
}: {
  messages: HistoryEntry[];
  item: Conversation;
  onOpenFile?: (file: FileReference) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (keys: string[], open: boolean) =>
    setExpanded((old) => {
      if (keys.some((key) => old.has(key)) === open) return old;
      const next = new Set(old);
      keys.forEach((key) => (open ? next.add(key) : next.delete(key)));
      return next;
    });
  const base = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  const attachments = (line: Line) =>
    [
      ...new Map(
        line.attachments?.map((attachment) => [
          String(attachment.id),
          attachment,
        ]),
      ).values(),
    ].map((attachment) => {
      const id = String(attachment.id ?? "");
      return (
        <a
          className="aw-link"
          key={id}
          href={`${base}/v1/agent-workbench/sessions/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(id)}`}
        >
          下载附件：{String(attachment.name ?? "文件")}
        </a>
      );
    });
  return historyReplies(messages, item.agent_id).map((reply) => (
    <TranscriptMessage
      key={reply.id}
      agent={item.agent_id}
      role={reply.role}
      timestamp={reply.timestamp}
    >
      {replySections(reply.lines).map((section) => {
        if (section.kind === "text") {
          const line = section.line;
          const label = {
            error: "原端错误",
            compaction: "上下文压缩",
            branch_summary: "分支摘要",
          }[line.kind];
          return (
            <div
              className={`aw-line${line.kind === "error" ? " aw-line-error" : ""}`}
              data-entry-id={line.id}
              key={line.id}
            >
              {label && <span className="aw-badge">{label}</span>}
              {line.kind === "duration" ? (
                <ActivityDuration milliseconds={line.details?.duration_ms} />
              ) : (
                <TranscriptText text={line.text} onOpenFile={onOpenFile} />
              )}
              {attachments(line)}
            </div>
          );
        }
        const ids = section.operations.map(({ line }) => `group:${line.id}`);
        const failed = section.operations.filter(({ line, results }) =>
          [line, ...results].some((part) => part.status === "failed"),
        ).length;
        return (
          <div
            data-entry-id={section.operations
              .flatMap(({ line, results }) => [line, ...results])
              .map((line) => line.id)
              .join(" ")}
            key={section.operations[0].line.id}
          >
            <TranscriptActivity
              names={section.operations.map(({ line }) => line.toolName ?? "")}
              failed={failed}
              open={ids.some((id) => expanded.has(id))}
              onToggle={(open) => toggle(ids, open)}
            >
              {section.operations.map((operation) => {
                const { line, results } = operation;
                const details = operationDetails(operation);
                const code = toolCode(line.text, line.toolName ?? "");
                const files =
                  onOpenFile && code.language && code.language !== "json"
                    ? commandFiles(code.text)
                    : [];
                const name =
                  line.toolName ||
                  (line.kind === "thinking"
                    ? "思考过程"
                    : line.kind === "tool_call"
                      ? "工具调用"
                      : "工具结果");
                const status = results.some(
                  (result) => result.status === "failed",
                )
                  ? "failed"
                  : line.status;
                return (
                  <div data-entry-id={line.id} key={line.id}>
                    <ActivityRow
                      name={name}
                      status={status}
                      details={details}
                      open={expanded.has(line.id)}
                      onToggle={(open) => toggle([line.id], open)}
                      onOpenFile={
                        details?.file && onOpenFile
                          ? () =>
                              onOpenFile({
                                path: details.file!.path,
                                line: details.file!.line ?? undefined,
                              })
                          : undefined
                      }
                    >
                      {line.text && !details?.questions?.length && (
                        <ToolCodeBlock
                          {...code}
                          label={
                            line.kind === "tool_call" ? code.label : "输出"
                          }
                        />
                      )}
                      {files.length > 0 && (
                        <div
                          className="aw-file-references"
                          aria-label="命令中的文件"
                        >
                          {files.map((file) => (
                            <button
                              type="button"
                              className="aw-file-link"
                              data-file-path={file.path}
                              data-file-line={file.line}
                              key={file.path}
                              onClick={() => onOpenFile?.(file)}
                            >
                              {file.path}
                            </button>
                          ))}
                        </div>
                      )}
                      {attachments(line)}
                      {results.length > 0 &&
                        results.map((result) => (
                          <div key={result.id} data-entry-id={result.id}>
                            {result.text &&
                              !result.details?.answers?.length && (
                                <ToolCodeBlock text={result.text} />
                              )}
                            {attachments(result)}
                          </div>
                        ))}
                    </ActivityRow>
                  </div>
                );
              })}
            </TranscriptActivity>
          </div>
        );
      })}
    </TranscriptMessage>
  ));
}
