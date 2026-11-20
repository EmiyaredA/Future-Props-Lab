import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAmadeusCapabilities } from "@features/amadeus/useAmadeusCapabilities";
import type { Conversation, RunDetail } from "@features/amadeus/protocol";

vi.mock("@features/code-agents", () => ({
  getAgents: vi.fn(async () => ({ items: [] })),
}));
vi.mock("@platform/api/client", () => ({
  fetchApiJson: vi.fn(async () => ({ items: [] })),
}));

const conversation = (id: string): Conversation => ({
  id,
  title: id,
  revision: 0,
  agent_id: "codex",
  model_id: null,
  created_at: "",
  updated_at: "",
});
const previous: RunDetail = {
  run: {
    id: "last",
    conversation_id: "old",
    status: "completed",
    model_id: "",
    partial_text: "",
    codex_image_generation: false,
  },
  events: [],
};

it("restores each conversation's last sent switch and defaults new chats to on", async () => {
  const setError = vi.fn();
  const { result, rerender } = renderHook(
    ({ current, runs }) =>
      useAmadeusCapabilities("owner", current, runs, setError),
    { initialProps: { current: conversation("old"), runs: [previous] } },
  );
  await waitFor(() => expect(result.current.codexImageGeneration).toBe(false));
  act(() => result.current.setModelId("another-model"));
  expect(result.current.codexImageGeneration).toBe(false);
  rerender({ current: conversation("new"), runs: [] });
  expect(result.current.codexImageGeneration).toBe(true);
  act(() => result.current.setCodexImageGeneration(false));
  rerender({ current: conversation("new"), runs: [] });
  expect(result.current.codexImageGeneration).toBe(false);
  rerender({ current: conversation("old"), runs: [previous] });
  expect(result.current.codexImageGeneration).toBe(false);
  expect(setError).not.toHaveBeenCalled();
});
