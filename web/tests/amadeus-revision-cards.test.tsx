import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityFeed } from "../src/features/amadeus/ActivityFeed";
import { buildDisplayTimeline } from "../src/features/amadeus/displayTimeline";
import type { Detail, RunDetail } from "../src/features/amadeus/protocol";

const at = "2026-09-30T09:00:00Z";
const conversation: Detail = {
  conversation: {
    id: "conversation",
    title: "修订",
    model_id: "mock",
    revision: 1,
    created_at: at,
    updated_at: at,
  },
  messages: [
    {
      id: "user",
      role: "user",
      content: "先给我草稿",
      references: [],
      created_at: at,
    },
  ],
  actions: [],
  questions: [],
};

function run(
  id: string,
  mode: "agent" | "plan",
  status = "completed",
): RunDetail {
  return {
    run: {
      id,
      conversation_id: "conversation",
      model_id: "mock",
      mode,
      status,
      partial_text: "",
    },
    events: [],
  };
}

function feed(
  detail: Detail,
  runs: RunDetail[],
  overrides?: {
    onReviseArtifact?: ReturnType<typeof vi.fn>;
    onReviseApproval?: ReturnType<typeof vi.fn>;
  },
) {
  render(
    <ActivityFeed
      detail={detail}
      runs={runs}
      onReference={vi.fn()}
      onApproval={vi.fn(async () => undefined)}
      onAnswer={vi.fn(async () => undefined)}
      onContinue={vi.fn(async () => undefined)}
      onReviseArtifact={overrides?.onReviseArtifact}
      onReviseApproval={overrides?.onReviseApproval}
    />,
  );
}

describe("Amadeus revision cards", () => {
  it("keeps pure answers as messages without an execution trace", () => {
    const answer = {
      ...conversation,
      messages: [
        ...conversation.messages,
        {
          id: "answer",
          role: "assistant",
          content: "解释如下",
          references: [],
          created_at: at,
        },
      ],
    };
    expect(buildDisplayTimeline(answer, []).tools).toHaveLength(0);
    feed(answer, []);
    expect(screen.getByText("解释如下")).toBeVisible();
    expect(screen.queryByRole("region", { name: "内容草稿" })).toBeNull();
  });

  it("renders an explicitly marked draft and submits edited text as feedback", async () => {
    const current = run("draft-run", "agent");
    current.events = [
      {
        sequence: 1,
        kind: "tool_call",
        created_at: at,
        payload: {
          tool_call_id: "artifact-1",
          tool_name: "present_artifact",
          arguments: { kind: "draft", title: "视频提示词草稿", body: "初稿" },
        },
      },
      {
        sequence: 2,
        kind: "tool_result",
        created_at: at,
        payload: {
          tool_call_id: "artifact-1",
          status: "done",
          result: { ok: true },
        },
      },
    ];
    const onReviseArtifact = vi.fn(async () => undefined);
    feed(conversation, [current], { onReviseArtifact });
    expect(screen.getByRole("region", { name: "内容草稿" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "编辑或补充说明" }));
    fireEvent.change(screen.getByRole("textbox", { name: "修订草稿" }), {
      target: { value: "用户改写的提示词" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "给 Amadeus 的补充说明" }),
      { target: { value: "再核对角色标签" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "请 AI 再修订" }));
    await waitFor(() =>
      expect(onReviseArtifact).toHaveBeenCalledWith(
        "draft-run",
        "draft",
        "用户改写的提示词",
        "再核对角色标签",
      ),
    );
  });

  it("shows a structured plan and makes a continued version read only", () => {
    const previous = run("plan-run", "plan");
    previous.events = [
      {
        sequence: 1,
        kind: "tool_call",
        created_at: at,
        payload: {
          tool_call_id: "plan-1",
          tool_name: "present_artifact",
          arguments: {
            kind: "plan",
            title: "修改计划",
            body: "先核对",
            steps: [{ title: "检查版本", detail: "读取最新 revision" }],
          },
        },
      },
      {
        sequence: 2,
        kind: "tool_result",
        created_at: at,
        payload: { tool_call_id: "plan-1", status: "done", result: {} },
      },
    ];
    const child = run("revision-run", "plan");
    child.run.source_run_id = "plan-run";
    feed(conversation, [previous, child]);
    expect(screen.getByText("检查版本")).not.toBeVisible();
    fireEvent.click(screen.getByText("已有后续版本 · 查看旧内容"));
    expect(screen.getByText("检查版本")).toBeVisible();
    expect(screen.queryByRole("button", { name: "执行计划" })).toBeNull();
  });

  it("submits complete edited parameters for a new proposal without executing", async () => {
    const action = {
      id: "action",
      tool_name: "fpl_operation:canvas.update",
      status: "pending",
      run_id: "write-run",
      arguments: {
        path_params: { project_id: "project-1" },
        body: { prompt: "旧稿", enabled: false },
        expected_revision: 4,
      },
      arguments_sha256: "a".repeat(64),
      created_at: at,
      updated_at: at,
    };
    const current = run("write-run", "agent", "waiting_approval");
    current.events = [
      {
        sequence: 1,
        kind: "tool_call",
        created_at: at,
        payload: {
          tool_call_id: "write-1",
          tool_name: "fpl_operation_write",
          arguments: action.arguments,
        },
      },
    ];
    const onReviseApproval = vi.fn(async () => undefined);
    feed({ ...conversation, actions: [action] }, [current], {
      onReviseApproval,
    });
    expect(screen.getByText("拟变更内容")).toBeVisible();
    expect(screen.getByText(/提示词 · 旧稿/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "编辑参数或补充说明" }));
    fireEvent.click(screen.getByRole("button", { name: "完整 JSON" }));
    fireEvent.change(screen.getByRole("textbox", { name: "完整参数 JSON" }), {
      target: {
        value: JSON.stringify({
          ...action.arguments,
          body: { prompt: "新稿", enabled: true },
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "请 AI 重新拟案" }));
    await waitFor(() =>
      expect(onReviseApproval).toHaveBeenCalledWith(
        "action",
        { ...action.arguments, body: { prompt: "新稿", enabled: true } },
        "",
      ),
    );
  });

  it("preserves failed and unknown tool states instead of marking them complete", () => {
    const failed = run("failed-run", "agent", "failed");
    failed.events = [
      {
        sequence: 1,
        kind: "tool_call",
        created_at: at,
        payload: {
          tool_call_id: "read-1",
          tool_name: "fpl_read",
          arguments: {},
        },
      },
      {
        sequence: 2,
        kind: "tool_result",
        created_at: at,
        payload: {
          tool_call_id: "read-1",
          status: "failed",
          result: { message: "读取失败" },
        },
      },
    ];
    expect(
      buildDisplayTimeline(conversation, [failed]).tools[0].displayStatus,
    ).toBe("failed");
    const action = {
      id: "unknown",
      tool_name: "run_script",
      status: "unknown",
      run_id: "unknown-run",
      arguments: { name: "validate.py" },
      arguments_sha256: "b".repeat(64),
      created_at: at,
      updated_at: at,
    };
    const unknown = run("unknown-run", "agent", "waiting_approval");
    unknown.events = [
      {
        sequence: 1,
        kind: "tool_call",
        created_at: at,
        payload: {
          tool_call_id: "run-1",
          tool_name: "run_script",
          arguments: action.arguments,
        },
      },
    ];
    feed({ ...conversation, actions: [action] }, [unknown]);
    expect(screen.getByText(/不会自动重试/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "批准并执行" })).toBeNull();
  });
});
