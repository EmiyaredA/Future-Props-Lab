import { expect, it } from "vitest";
import { conversationUsage } from "../../src/features/amadeus/conversationUsage";
import { messageAnchors } from "../../src/features/amadeus/useMessageActions";
import type {
  ChatMessage,
  RunDetail,
} from "../../src/features/amadeus/protocol";

it("uses the latest distinct run snapshots and keeps unknown fields separate from zero", () => {
  const snapshot = (
    id: string,
    sequence: number,
    usage?: RunDetail["run"]["usage"],
  ): RunDetail => ({
    run: {
      id,
      conversation_id: "active",
      status: "running",
      model_id: "fixture",
      created_at: `2026-11-08T00:00:0${id}Z`,
      partial_text: "",
      usage,
    },
    events: [{ kind: "run_usage", sequence, payload: {}, created_at: "" }],
  });
  const live = snapshot("2", 5, {
    input_tokens: 12,
    context_used: 0,
    context_limit: 100,
  });
  const history = [
    snapshot("1", 1, { input_tokens: 8, output_tokens: 0 }),
    live,
    snapshot("2", 3, { input_tokens: 4, context_used: 60 }),
    snapshot("3", 0),
    { ...live, run: { ...live.run, id: "other", conversation_id: "another" } },
  ];
  const state = conversationUsage("active", history, live.run);
  expect(state.current?.usage).toMatchObject({
    context_used: 0,
    context_limit: 100,
  });
  expect(state).toMatchObject({ runCount: 3, reportedRuns: 2 });
  expect(state.rows.find(({ key }) => key === "input_tokens")).toMatchObject({
    total: 20,
    recorded: 2,
  });
  expect(state.rows.find(({ key }) => key === "output_tokens")).toMatchObject({
    total: 0,
    recorded: 1,
  });
  expect(state.rows.find(({ key }) => key === "total_tokens")).toMatchObject({
    total: null,
    recorded: 0,
  });
  expect(
    conversationUsage("active", history, null).current?.usage,
  ).toBeUndefined();
  expect(conversationUsage("another", [], live.run)).toMatchObject({
    runCount: 0,
    active: false,
  });
});

it("anchors an assembled response to its last saved segment only", () => {
  const saved: ChatMessage = {
    id: "persisted",
    role: "assistant",
    run_id: "run",
    content: "前后",
    created_at: "2026-11-08T00:00:00Z",
    references: [],
    pinned: true,
  };
  const row = (id: string, streaming = false) => ({
    kind: "message" as const,
    at: saved.created_at,
    sequence: 1,
    message: { ...saved, id },
    streaming,
  });
  const rows = [row("before"), row("after")];
  expect(messageAnchors([], [...rows, row("live", true)]).size).toBe(0);
  expect([...messageAnchors([saved], rows)]).toEqual([["after", saved]]);
  expect([...messageAnchors([saved], [row("persisted")])]).toEqual([
    ["persisted", saved],
  ]);
});
