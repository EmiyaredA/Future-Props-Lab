import { Fragment, useEffect, useRef } from "react";
import {
  TranscriptActivity,
  TranscriptDisclosure,
  TranscriptMessage,
  TranscriptText,
} from "./TranscriptMessage";
import { ActivityRow } from "./ActivityRow";
import type { SourceTarget } from "./WorkbenchSourcePane";
import type { ChatDetail } from "./executionApi";

const statusLabels: Record<string, string> = {
  running: "正在回复…",
  waiting_approval: "等待确认",
  cancelling: "正在停止…",
  cancelled: "已停止",
  interrupted: "已中断",
  failed: "运行失败",
};
const approvalLabels: Record<string, string> = {
  pending: "等待批准",
  approved: "已批准",
  rejected: "已拒绝",
  executing: "正在执行",
  completed: "已执行",
  failed: "执行失败",
  expired: "已失效",
  unknown: "结果未知",
};
const instructionLabels = {
  sending: "正在插入",
  accepted: "Agent 已接收指令",
  rejected: "插入被拒绝",
  unknown: "插入结果未知",
};
type Turn = ChatDetail["turns"][number];

function ApprovalBlock({
  approval,
  turnId,
  busy,
  unlocked,
  decide,
}: {
  approval: Turn["approvals"][number];
  turnId: string;
  busy: boolean;
  unlocked: boolean;
  decide: (turn: string, approval: string, approved: boolean) => void;
}) {
  const pending = approval.status === "pending";
  const title = `${approval.kind === "write" ? "写入文件" : "运行命令"} · ${approval.title}`;
  return pending ? (
    <div className="cloud-approval" key={approval.id}>
      <span className="aw-badge">{approvalLabels[approval.status]}</span>
      <strong>{title}</strong>
      <pre>{approval.preview || "内容无差异"}</pre>
      {unlocked && (
        <div className="cloud-pane-actions">
          <button
            className="btn"
            disabled={busy}
            onClick={() => decide(turnId, approval.id, false)}
          >
            拒绝
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => decide(turnId, approval.id, true)}
          >
            批准本次
          </button>
        </div>
      )}
    </div>
  ) : (
    <TranscriptDisclosure
      key={approval.id}
      title={`${title} · ${approvalLabels[approval.status] ?? approval.status}`}
    >
      <TranscriptText text={approval.preview || "内容无差异"} raw />
    </TranscriptDisclosure>
  );
}

function ReplyBody({
  turn,
  busy,
  unlocked,
  decide,
  openSource,
}: {
  turn: Turn;
  busy: boolean;
  unlocked: boolean;
  decide: (turn: string, approval: string, approved: boolean) => void;
  openSource: (target: SourceTarget) => void;
}) {
  // The persisted offsets count Unicode code points, including emoji.
  const answer = Array.from(turn.answer);
  const events = [
    ...(turn.activity ?? []).map((activity) => ({
      kind: "activity" as const,
      ...activity,
    })),
    ...(turn.instructions ?? []).map((instruction) => ({
      kind: "instruction" as const,
      ...instruction,
    })),
    ...turn.approvals.map((approval) => ({
      kind: "approval" as const,
      approval,
      offset: approval.offset ?? answer.length,
      sequence: approval.sequence,
    })),
  ].sort(
    (a, b) => a.offset - b.offset || (a.sequence ?? -1) - (b.sequence ?? -1),
  );
  const sections = [];
  let offset = 0;
  for (let index = 0; index < events.length;) {
    const event = events[index];
    if (event.offset > offset) {
      sections.push(
        <TranscriptText
          key={`text:${offset}`}
          text={answer.slice(offset, event.offset).join("")}
        />,
      );
      offset = event.offset;
    }
    if (event.kind === "approval") {
      sections.push(
        <ApprovalBlock
          key={`approval:${event.approval.id}`}
          approval={event.approval}
          turnId={turn.id}
          busy={busy}
          unlocked={unlocked}
          decide={decide}
        />,
      );
      index++;
      continue;
    }
    if (event.kind === "instruction") {
      sections.push(
        <div className="aw-instruction" key={`instruction:${event.request_id}`}>
          <strong>{instructionLabels[event.status]}</strong>
          <span>{event.text}</span>
        </div>,
      );
      index++;
      continue;
    }
    const activities = [event];
    index++;
    for (
      let next = events[index];
      next?.kind === "activity" && next.offset === offset;
      next = events[++index]
    )
      activities.push(next);
    const failed = activities.filter(
      (activity) => activity.status === "failed",
    ).length;
    sections.push(
      <TranscriptActivity
        key={`activity:${event.call_id}`}
        names={activities.map((activity) => activity.name)}
        failed={failed}
      >
        {activities.map((activity) => (
          <ActivityRow
            key={activity.call_id}
            name={activity.name}
            status={activity.status}
            details={activity.details}
            onOpenFile={
              activity.source_available && unlocked
                ? () =>
                    openSource({ turnId: turn.id, callId: activity.call_id })
                : undefined
            }
          />
        ))}
      </TranscriptActivity>,
    );
  }
  if (offset < answer.length)
    sections.push(
      <TranscriptText
        key={`text:${offset}`}
        text={answer.slice(offset).join("")}
      />,
    );
  return sections;
}

export function ChatTranscript({
  chat,
  busy,
  unlocked,
  decide,
  openSource,
}: {
  chat?: ChatDetail;
  busy: boolean;
  unlocked: boolean;
  decide: (turn: string, approval: string, approved: boolean) => void;
  openSource: (target: SourceTarget) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [chat]);

  return (
    <div
      className="aw-messages"
      ref={list}
      aria-label="会话记录"
      onScroll={(event) => {
        const node = event.currentTarget;
        follow.current =
          node.scrollHeight - node.scrollTop - node.clientHeight < 60;
      }}
    >
      {!chat?.turns.length && (
        <p className="aw-subtle">发送消息后，回复会在这里逐步显示。</p>
      )}
      {chat?.turns.map((turn) => (
        <Fragment key={turn.id}>
          <TranscriptMessage agent={chat.agent_id} role="user">
            <TranscriptText text={turn.prompt} />
          </TranscriptMessage>
          <TranscriptMessage
            agent={chat.agent_id}
            timestamp={
              turn.started_at
                ? new Date(turn.started_at * 1000).toISOString()
                : undefined
            }
          >
            <ReplyBody
              turn={turn}
              busy={busy}
              unlocked={unlocked}
              decide={decide}
              openSource={openSource}
            />
            {statusLabels[turn.status] && (
              <p className="aw-turn-status aw-subtle" role="status">
                {turn.error ?? statusLabels[turn.status]}
              </p>
            )}
          </TranscriptMessage>
        </Fragment>
      ))}
    </div>
  );
}
