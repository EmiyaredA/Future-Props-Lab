import { describe, expect, it } from "vitest";
import {
  buildAgentHistory,
  conversationTimeline,
} from "../src/features/amadeus/history";

describe("Amadeus durable tool transcript", () => {
  it("links approval only to the write call after an earlier read", () => {
    const events = [
      {
        sequence: 1,
        kind: "tool_call",
        created_at: "2026-09-27T00:00:01Z",
        payload: { tool_call_id: "read", tool_name: "fpl_read", arguments: {} },
      },
      {
        sequence: 2,
        kind: "tool_call",
        created_at: "2026-09-27T00:00:02Z",
        payload: {
          tool_call_id: "write",
          tool_name: "video_timeline_batch",
          arguments: {},
        },
      },
    ];
    const action = {
      id: "action",
      run_id: "run",
      tool_name: "video_timeline_batch",
      arguments: {},
      arguments_sha256: "0".repeat(64),
      status: "pending",
      created_at: "2026-09-27T00:00:02Z",
      updated_at: "2026-09-27T00:00:02Z",
    };
    const timeline = conversationTimeline(
      [],
      [
        {
          run: {
            id: "run",
            conversation_id: "conversation",
            model_id: "mock",
            status: "waiting_approval",
            partial_text: "",
          },
          events,
        },
      ],
      [action],
      [],
    );
    expect(
      timeline
        .filter((item) => item.kind === "tool")
        .map((item) => item.action?.id),
    ).toEqual([undefined, "action"]);
  });

  it("restores tool calls and results before the saved assistant reply", () => {
    const history = buildAgentHistory(
      [
        {
          id: "user-1",
          role: "user",
          content: "读取片段",
          references: [],
          created_at: "2026-09-21T00:00:00Z",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "片段已读取。",
          references: [],
          run_id: "run-1",
          created_at: "2026-09-21T00:00:01Z",
        },
      ],
      [
        {
          run: {
            id: "run-1",
            conversation_id: "conversation-1",
            model_id: "model-1",
            status: "completed",
            partial_text: "片段已读取。",
          },
          events: [
            {
              sequence: 1,
              kind: "tool_call",
              payload: {
                tool_call_id: "call-1",
                tool_name: "fpl_operation_read",
                arguments: { operation: "video.get_timeline" },
              },
            },
            {
              sequence: 2,
              kind: "tool_result",
              payload: {
                tool_call_id: "call-1",
                name: "fpl_operation_read",
                result: { revision: 3 },
              },
            },
          ],
        },
      ],
    );

    expect(history.map((item) => item.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(history[1].tool_calls?.[0]).toMatchObject({
      id: "call-1",
      name: "fpl_operation_read",
    });
    expect(history[2]).toMatchObject({
      tool_call_id: "call-1",
      tool_name: "fpl_operation_read",
    });
  });
});
