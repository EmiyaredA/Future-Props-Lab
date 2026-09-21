import { describe, expect, it } from "vitest";
import { buildAgentHistory } from "../src/features/amadeus/history";

describe("Amadeus durable tool transcript", () => {
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
