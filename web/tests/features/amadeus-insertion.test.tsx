import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAmadeusRun } from "@features/amadeus/useAmadeusRun";
import { buildDisplayTimeline } from "@features/amadeus/displayTimeline";
import type { Detail, RunDetail } from "@features/amadeus/protocol";
import { fetchApiJson } from "@platform/api/client";

vi.mock("@platform/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@platform/api/client")>()),
  fetchApiJson: vi.fn(),
}));

const detail: Detail = {
  conversation: {
    id: "chat",
    title: "test",
    model_id: null,
    revision: 0,
    created_at: "",
    updated_at: "",
  },
  messages: [],
  actions: [],
};
const running: RunDetail = {
  run: {
    id: "run",
    conversation_id: "chat",
    status: "running",
    model_id: "",
    partial_text: "",
  },
  events: [],
  can_receive: true,
};

it("reuses an uncertain request ID, blocks duplicate clicks and preserves unsent input", async () => {
  const isCurrent = () => true;
  const clearDraft = vi.fn();
  const requests: { request_id: string; text: string }[] = [];
  let rejectFirst!: (error: Error) => void;
  vi.mocked(fetchApiJson)
    .mockReset()
    .mockImplementation((path, init) => {
      if (path === "/v1/amadeus/runs/active")
        return Promise.resolve(running) as never;
      if (path.endsWith("/instructions")) {
        requests.push(JSON.parse(String(init?.body)));
        return requests.length === 1
          ? (new Promise((_resolve, reject) => {
              rejectFirst = reject;
            }) as never)
          : (Promise.resolve({ status: "accepted" }) as never);
      }
      if (path.endsWith("/conversations/chat"))
        return Promise.resolve(detail) as never;
      return new Promise(() => {}) as never;
    });
  const input: Parameters<typeof useAmadeusRun>[0] = {
    owner: "owner",
    conversations: {
      getDetail: () => detail,
      open: vi.fn(),
      openRecoveredRun: vi.fn(),
      refreshList: vi.fn(),
      acceptRun: vi.fn(),
      updateDetail: vi.fn(),
      draft: "补充",
      references: [],
      loaded: [],
      captureSelection: () => isCurrent,
      selectionPending: () => false,
      adopt: vi.fn(),
      clearDraft,
    },
    capabilities: {
      agents: [],
      agentId: "codex",
      modelId: "default",
      modelVariant: "",
      modelVariants: [],
      harnessEffort: "",
      harnessEfforts: [],
      harnessCatalogStatus: null,
      codexImageGeneration: true,
      fast: false,
      fastAvailable: false,
      setFast: vi.fn(),
      reasoningEffort: "",
      keepModelSelection: vi.fn(),
    },
    projects: [],
    scopedContexts: [],
    isImporting: () => false,
    setError: vi.fn(),
    showAvatarState: vi.fn(),
  };
  const view = renderHook(() => useAmadeusRun(input));
  await waitFor(() => expect(view.result.current.canInsert).toBe(true));
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.send();
  });
  await act(() => view.result.current.send());
  expect(requests).toHaveLength(1);
  await act(async () => {
    rejectFirst(new Error("lost acknowledgement"));
    await pending;
  });
  expect(clearDraft).not.toHaveBeenCalled();
  await act(() => view.result.current.send());
  expect(requests).toHaveLength(2);
  expect(requests[1].request_id).toBe(requests[0].request_id);
  expect(clearDraft).toHaveBeenCalledExactlyOnceWith(isCurrent, {
    text: "补充",
    references: [],
  });
  view.unmount();
});

it.each(["后文", "前文"])(
  "places insertion between repeated reply segments after reload (%s)",
  (after) => {
    const at = "2026-11-20T00:00:00Z";
    const snapshot: Detail = {
      ...detail,
      messages: [
        {
          id: "inserted",
          role: "user",
          content: "补充",
          references: [],
          created_at: at,
          run_id: "run",
        },
        {
          id: "saved-answer",
          role: "assistant",
          content: `前文${after}`,
          references: [],
          created_at: at,
          run_id: "run",
        },
      ],
    };
    const record: RunDetail = {
      run: {
        ...running.run,
        status: "completed",
        partial_text: `前文${after}`,
        created_at: at,
        finished_at: at,
      },
      events: [
        {
          sequence: 1,
          kind: "assistant_delta",
          payload: { text: "前文" },
          created_at: at,
        },
        {
          sequence: 2,
          kind: "user_instruction",
          payload: { message_id: "inserted" },
          created_at: at,
        },
        {
          sequence: 3,
          kind: "assistant_delta",
          payload: { text: after },
          created_at: at,
        },
        {
          sequence: 4,
          kind: "assistant_message",
          payload: { text: `前文${after}` },
          created_at: at,
        },
      ],
    };
    const messages = buildDisplayTimeline(snapshot, [record]).entries.filter(
      (item) => item.kind === "message",
    );
    expect(messages.map((item) => item.message.content)).toEqual([
      "前文",
      "补充",
      after,
    ]);
  },
);
