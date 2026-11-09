import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ActivityFeed,
  ExecutionInspector,
} from "../../src/features/amadeus/ActivityFeed";
import { buildDisplayTimeline } from "../../src/features/amadeus/displayTimeline";
import { bottomFollowIntent } from "../../src/features/amadeus/bottomFollowIntent";
import { prepareStreamingMarkdown } from "../../src/features/amadeus/streamingMarkdown";
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
  it("repairs unfinished Markdown while showing the final saved reply once", () => {
    const text = "这是 **未完";
    expect(prepareStreamingMarkdown(text)).toBe("这是 **未完**");
    const run: RunDetail = {
      run: {
        id: "live",
        conversation_id: "conversation",
        model_id: "fixture",
        status: "running",
        partial_text: text,
      },
      events: [],
    };
    const live = { ...detail, messages: detail.messages.slice(0, 1) };
    expect(buildDisplayTimeline(live, [run]).entries.at(-1)).toMatchObject({
      kind: "message",
      message: { id: "stream:live", content: text },
    });
    const saved = {
      ...live,
      messages: [
        ...live.messages,
        {
          id: "saved",
          role: "assistant",
          content: text,
          run_id: "live",
          references: [],
          created_at: at,
        },
      ],
    };
    expect(
      buildDisplayTimeline(saved, [run]).entries.map(
        (item) => item.kind === "message" && item.message.id,
      ),
    ).toEqual(["user", "saved"]);
  });

  it("keeps ordered chunks and terminal states across a saved reply and continuation", () => {
    const before = "先读取。";
    const after = "已读取，等待批准。";
    const timestamp = "2026-09-27T00:00:02Z";
    const action = {
      id: "action",
      tool_name: "video_timeline_batch",
      status: "completed",
      run_id: "initial",
      arguments: { project_id: "project" },
      arguments_sha256: "0".repeat(64),
      created_at: timestamp,
      updated_at: timestamp,
    };
    const current: Detail = {
      ...detail,
      messages: detail.messages.slice(0, 1),
      actions: [action],
    };
    const initial: RunDetail = {
      run: {
        id: "initial",
        conversation_id: current.conversation.id,
        model_id: "fixture",
        status: "running",
        partial_text: before + after,
        updated_at: timestamp,
        usage: { input_tokens: 101, context_used: 0, context_limit: 500 },
      },
      events: [
        {
          sequence: 1,
          kind: "assistant_delta",
          created_at: timestamp,
          payload: { text: before },
        },
        {
          sequence: 2,
          kind: "tool_call",
          created_at: timestamp,
          payload: { tool_call_id: "read", tool_name: "fpl_read" },
        },
        {
          sequence: 3,
          kind: "tool_result",
          created_at: timestamp,
          payload: { tool_call_id: "read", result: [] },
        },
        {
          sequence: 4,
          kind: "assistant_delta",
          created_at: timestamp,
          payload: { text: after },
        },
        {
          sequence: 5,
          kind: "tool_call",
          created_at: timestamp,
          payload: {
            tool_call_id: "write",
            action_id: "action",
            tool_name: "video_timeline_batch",
          },
        },
      ],
    };
    const saved: Detail = {
      ...current,
      messages: [
        ...current.messages,
        {
          id: "saved",
          role: "assistant",
          content: before + after,
          references: [],
          run_id: "initial",
          created_at: timestamp,
        },
      ],
    };
    const resumed: RunDetail = {
      run: {
        id: "resumed",
        source_run_id: "initial",
        conversation_id: current.conversation.id,
        model_id: "fixture",
        status: "cancelled",
        partial_text: "继续执行。",
        finished_at: "2026-09-27T00:00:05Z",
      },
      events: [
        {
          sequence: 1,
          kind: "assistant_delta",
          created_at: "2026-09-27T00:00:04Z",
          payload: { text: "继续执行。" },
        },
      ],
    };
    const completed = {
      ...initial,
      run: { ...initial.run, status: "waiting_approval" },
    };
    expect(
      buildDisplayTimeline(current, [initial]).entries.map(({ kind }) => kind),
    ).toEqual([
      "message",
      "message",
      "milestone",
      "message",
      "action",
      "run_summary",
    ]);
    const final = buildDisplayTimeline(saved, [completed, resumed]);
    expect(
      final.entries
        .filter((item) => item.kind === "message")
        .map((item) => item.message.id),
    ).toEqual([
      "user",
      "chunk:initial:1",
      "chunk:initial:4",
      "chunk:resumed:1",
    ]);
    show(saved, [completed, resumed]);
    expect(screen.getByText("Token · 输入 101")).toBeVisible();
    expect(screen.getByText("上下文 0 / 500 Tokens")).toBeVisible();
    expect(screen.getByText("用量未记录")).toBeVisible();
    expect(screen.getByText("运行已取消")).toBeVisible();
  });

  it("streams text after tools even when an earlier reply is already final", () => {
    const current = { ...detail, messages: detail.messages.slice(0, 1) };
    const event = (
      sequence: number,
      kind: string,
      payload: Record<string, unknown>,
    ) => ({ sequence, kind, payload, created_at: at });
    const first = event(1, "assistant_message", { text: "先核对项目。" });
    const call = event(2, "tool_call", {
      tool_call_id: "read",
      tool_name: "fpl_read",
    });
    const delta = event(3, "assistant_delta", { text: "已有 **1" });
    const tail = event(4, "assistant_delta", { text: " 个节点**。" });
    const run = {
      id: "mixed",
      conversation_id: "conversation",
      model_id: "mock",
      status: "running",
      partial_text: "已有 **1 个节点**。",
    };
    const live = buildDisplayTimeline(current, [
      { run, events: [tail, first, call, delta, delta] },
    ]);
    expect(live.entries.map((entry) => entry.kind)).toEqual([
      "message",
      "message",
      "milestone",
      "message",
    ]);
    expect(live.entries.at(-1)).toMatchObject({
      streaming: true,
      message: { id: "chunk:mixed:3", content: run.partial_text },
    });

    const final = event(5, "assistant_message", {
      text: run.partial_text + "读取完毕。",
    });
    const completed = {
      run: { ...run, status: "completed" },
      events: [first, call, delta, tail, final],
    };
    const response = {
      id: "saved-mixed",
      role: "assistant" as const,
      content: run.partial_text,
      run_id: run.id,
      references: [],
      created_at: at,
    };
    const saved = { ...current, messages: [...current.messages, response] };
    const history = buildDisplayTimeline(saved, [completed]).entries.filter(
      (entry) => entry.kind === "message",
    );
    expect(history.map((entry) => entry.message.id)).toEqual([
      "user",
      "chunk:mixed:1",
      "chunk:mixed:3",
    ]);
    expect(history.at(-1)).toMatchObject({
      message: { content: final.payload.text },
    });
    expect(history.at(-1)?.streaming).toBeFalsy();

    const authoritative = {
      ...current,
      messages: [
        ...current.messages,
        { ...response, content: "旧记录里保存的完整回复。" },
      ],
    };
    const restored = buildDisplayTimeline(authoritative, [completed]).entries;
    expect(
      restored
        .filter((entry) => entry.kind === "message")
        .map((entry) => entry.message.id),
    ).toEqual(["user", "saved-mixed"]);
    expect(restored.some((entry) => entry.kind === "milestone")).toBe(true);
  });

  it("only releases bottom follow for a scroll away and rearms near the end", () => {
    expect(bottomFollowIntent(true, 200, 180, 70, false)).toBe(true);
    expect(bottomFollowIntent(true, 200, 180, 70, true)).toBe(false);
    expect(bottomFollowIntent(false, 180, 220, 30, true)).toBe(true);
  });

  it("replays an out-of-order historical turn without repeating a final snapshot", () => {
    const first = "先看画布。";
    const second = "看完了。";
    const reference = {
      id: "project",
      application: "视觉创作",
      name: "画布",
      value: "",
      source: "",
    };
    const run: RunDetail = {
      run: {
        id: "replay",
        conversation_id: "conversation",
        model_id: "fixture",
        status: "completed",
        partial_text: first + second,
        created_at: at,
      },
      events: [
        {
          sequence: 4,
          kind: "assistant_message",
          payload: { text: first + second },
        },
        {
          sequence: 2,
          kind: "tool_call",
          payload: { tool_call_id: "read", tool_name: "fpl_read" },
          created_at: at,
        },
        {
          sequence: 1,
          kind: "assistant_delta",
          payload: { text: first },
          created_at: "2026-09-27T00:00:03Z",
        },
        { sequence: 3, kind: "assistant_delta", payload: { text: second } },
      ],
    };
    const historical: Detail = {
      ...detail,
      messages: [
        detail.messages[0],
        {
          id: "saved",
          role: "assistant",
          run_id: run.run.id,
          content: first + "\n\n" + second,
          references: [reference],
          created_at: "2026-09-27T00:00:04Z",
        },
      ],
    };
    const { entries } = buildDisplayTimeline(historical, [run]);
    expect(entries.map((row) => row.kind)).toEqual([
      "message",
      "message",
      "milestone",
      "message",
      "run_summary",
    ]);
    expect(entries[3]).toMatchObject({
      message: { content: second, references: [reference] },
    });
  });

  it("groups child investigations and switches tool details with the keyboard", () => {
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
          {
            sequence: 6,
            kind: "tool_call",
            created_at: "2026-09-27T00:00:05Z",
            payload: { tool_call_id: "read", tool_name: "fpl_read" },
          },
        ],
      },
    ];
    show(detail, runs);
    expect(screen.getByRole("button", { name: /部分步骤失败/ })).toBeVisible();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <ExecutionInspector
        tools={buildDisplayTimeline(detail, runs).tools}
        selected={null}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "查看其他工具调用" });
    fireEvent.keyDown(trigger, { key: "Home" });
    const option = screen.getByRole("option", { name: /^1 · / });
    expect(option).toHaveFocus();
    fireEvent.keyDown(option, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(trigger, { key: "Home" });
    fireEvent.keyDown(screen.getByRole("option", { name: /^1 · / }), {
      key: "Enter",
    });
    expect(onSelect).toHaveBeenCalledWith("agent-run:delegate");
    rerender(
      <ExecutionInspector
        tools={buildDisplayTimeline(detail, runs).tools}
        selected="agent-run:delegate"
        onSelect={onSelect}
        onClose={onClose}
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

  it("keeps answered questions compact and exposes the answer when opened", () => {
    show(
      {
        ...detail,
        questions: [
          {
            id: "answered",
            run_id: "plan-run",
            tool_call_id: "ask-1",
            prompt: "新增哪种轨道？",
            options: [],
            allow_text: true,
            status: "answered",
            answer: { answer: "画面轨", note: "保持为空" },
            created_at: at,
            updated_at: at,
          },
        ],
      },
      [],
    );
    const disclosure = screen.getByText("已回答").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("已回答"));
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText("你的回答 · 画面轨")).toBeVisible();
  });
});
