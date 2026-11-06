import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ActivityFeed,
  ExecutionInspector,
} from "../../src/features/amadeus/ActivityFeed";
import { buildDisplayTimeline } from "../../src/features/amadeus/displayTimeline";
import type { Detail, RunDetail } from "../../src/features/amadeus/protocol";

const at = "2026-09-27T00:00:00Z";
const detail: Detail = {
  conversation: {
    id: "conversation",
    title: "剪辑任务",
    model_id: "mock",
    revision: 1,
    created_at: at,
    updated_at: at,
  },
  messages: [
    {
      id: "user",
      role: "user",
      content: "新增画面轨",
      references: [],
      created_at: at,
    },
    {
      id: "plan",
      role: "assistant",
      content: "先读取时间线，再请求批准。",
      references: [],
      run_id: "plan-run",
      created_at: "2026-09-27T00:00:01Z",
    },
  ],
  actions: [],
  questions: [],
};

function show(current: Detail, runs: RunDetail[]) {
  const onApproval = vi.fn(async () => undefined);
  const onAnswer = vi.fn(async () => undefined);
  const onContinue = vi.fn(async () => undefined);
  render(
    <ActivityFeed
      detail={current}
      runs={runs}
      onReference={vi.fn()}
      onApproval={onApproval}
      onAnswer={onAnswer}
      onContinue={onContinue}
    />,
  );
  return { onApproval, onAnswer, onContinue };
}

describe("Amadeus activity feed", () => {
  it("groups child investigations in the execution inspector", () => {
    const runs: RunDetail[] = [
      {
        run: {
          id: "agent-run",
          conversation_id: "conversation",
          model_id: "mock",
          mode: "agent",
          status: "completed",
          partial_text: "",
        },
        events: [
          {
            sequence: 1,
            kind: "tool_call",
            created_at: "2026-09-27T00:00:02Z",
            payload: {
              tool_call_id: "delegate",
              tool_name: "delegate_readonly",
              arguments: { tasks: ["检查素材", "检查时间线"] },
            },
          },
          ...["检查素材", "检查时间线"].flatMap((task, index) => [
            {
              sequence: 2 + index * 2,
              kind: "subagent_start",
              created_at: "2026-09-27T00:00:03Z",
              payload: { id: `delegate:${index + 1}`, task },
            },
            {
              sequence: 3 + index * 2,
              kind: "subagent_finish",
              created_at: "2026-09-27T00:00:04Z",
              payload: { id: `delegate:${index + 1}`, task, status: "done" },
            },
          ]),
        ],
      },
    ];
    show(detail, runs);
    expect(screen.getByRole("button", { name: /部分步骤失败/ })).toBeVisible();
    render(
      <ExecutionInspector
        tools={buildDisplayTimeline(detail, runs).tools}
        runs={runs}
        selected={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("检查素材 · 完成")).toBeVisible();
    expect(screen.getByText("检查时间线 · 完成")).toBeVisible();
  });

  it("shows a completed plan with an in-conversation Agent action", () => {
    const { onContinue } = show(detail, [
      {
        run: {
          id: "plan-run",
          conversation_id: "conversation",
          model_id: "mock",
          mode: "plan",
          status: "completed",
          partial_text: "先读取时间线，再请求批准。",
        },
        events: [],
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "执行计划" }));
    expect(onContinue).toHaveBeenCalledWith(
      "plan-run",
      "agent",
      expect.stringContaining("重新读取"),
    );
  });

  it("keeps a restored approval within its tool card", () => {
    const action = {
      id: "action",
      tool_name: "video_timeline_batch",
      status: "pending",
      run_id: "agent-run",
      arguments: { project_id: "video-1", expected_revision: 0 },
      arguments_sha256: "0".repeat(64),
      created_at: "2026-09-27T00:00:03Z",
      updated_at: "2026-09-27T00:00:03Z",
    };
    const { onApproval } = show({ ...detail, actions: [action] }, [
      {
        run: {
          id: "agent-run",
          conversation_id: "conversation",
          model_id: "mock",
          mode: "agent",
          status: "waiting_approval",
          partial_text: "",
        },
        events: [
          {
            sequence: 1,
            kind: "tool_call",
            created_at: "2026-09-27T00:00:02Z",
            payload: {
              tool_call_id: "call",
              tool_name: "video_timeline_batch",
              arguments: action.arguments,
            },
          },
        ],
      },
    ]);
    expect(screen.getAllByText(/调整视频时间线/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "批准并执行" }));
    expect(onApproval).toHaveBeenCalledWith("action", true);
  });

  it("asks one question and preserves an answered question for continuation", async () => {
    const question = {
      id: "question",
      run_id: "plan-run",
      tool_call_id: "ask-1",
      prompt: "新增哪种轨道？",
      options: ["画面轨", "音频轨"],
      allow_text: true,
      status: "pending",
      answer: null,
      created_at: "2026-09-27T00:00:02Z",
      updated_at: "2026-09-27T00:00:02Z",
    };
    const runs: RunDetail[] = [
      {
        run: {
          id: "plan-run",
          conversation_id: "conversation",
          model_id: "mock",
          mode: "plan",
          status: "waiting_question",
          partial_text: "",
        },
        events: [],
      },
    ];
    const { onAnswer } = show({ ...detail, questions: [question] }, runs);
    fireEvent.click(screen.getByRole("button", { name: "画面轨" }));
    fireEvent.change(screen.getByRole("textbox", { name: "补充说明" }), {
      target: { value: "保持为空" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith(question, "画面轨", "保持为空"),
    );
  });
});
