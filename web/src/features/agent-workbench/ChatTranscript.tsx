import { Fragment, useEffect, useRef } from "react";
import { WorkbenchMessage } from "./ConversationView";
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

export function ChatTranscript({
  chat,
  busy,
  unlocked,
  decide,
}: {
  chat?: ChatDetail;
  busy: boolean;
  unlocked: boolean;
  decide: (turn: string, approval: string, approved: boolean) => void;
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
          <WorkbenchMessage
            agent={chat.agent_id}
            entry={{
              text: turn.prompt,
              role: "user",
              kind: "message",
              attachments: [],
            }}
          />
          {turn.answer && (
            <WorkbenchMessage
              agent={chat.agent_id}
              entry={{
                text: turn.answer,
                role: "assistant",
                kind: "message",
                attachments: [],
              }}
            />
          )}
          {turn.approvals.map((approval) => (
            <div className="cloud-approval" key={approval.id}>
              <strong>
                {approval.kind === "write" ? "写入文件" : "运行命令"} ·{" "}
                {approval.title}
              </strong>
              <pre>{approval.preview || "内容无差异"}</pre>
              <span>{approvalLabels[approval.status] ?? approval.status}</span>
              {approval.status === "pending" && unlocked && (
                <div className="cloud-pane-actions">
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => decide(turn.id, approval.id, false)}
                  >
                    拒绝
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => decide(turn.id, approval.id, true)}
                  >
                    批准本次
                  </button>
                </div>
              )}
            </div>
          ))}
          {statusLabels[turn.status] && (
            <p className="aw-subtle" role="status">
              {turn.error ?? statusLabels[turn.status]}
            </p>
          )}
        </Fragment>
      ))}
    </div>
  );
}
