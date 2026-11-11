import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAmadeusAttachments } from "@features/amadeus/useAmadeusAttachments";
import { useAmadeusRun } from "@features/amadeus/useAmadeusRun";
import type { Detail, RunDetail } from "@features/amadeus/protocol";
import { fetchApiJson } from "@platform/api/client";

vi.mock("@platform/api/client", () => ({ fetchApiJson: vi.fn() }));

it("keeps successfully imported attachments when another file fails", async () => {
  const isCurrent = () => true;
  const detail: Detail = {
    conversation: {
      id: "chat",
      title: "Conversation",
      model_id: "",
      revision: 1,
      created_at: "",
      updated_at: "",
    },
    messages: [],
    actions: [],
  };
  const addReference = vi.fn();
  const setError = vi.fn();
  vi.mocked(fetchApiJson)
    .mockReset()
    .mockRejectedValueOnce(new Error("格式不支持"))
    .mockResolvedValueOnce({ name: "good.txt", bytes: 10 });
  const { result } = renderHook(() =>
    useAmadeusAttachments(
      "owner",
      {
        detail,
        getDetail: () => detail,
        captureSelection: () => isCurrent,
        adopt: vi.fn(),
        addReference,
        refreshList: vi.fn(),
        references: [],
        selectionPending: () => false,
        selectionSignal: () => new AbortController().signal,
      },
      vi.fn(),
      setError,
    ),
  );

  await act(() =>
    result.current.importAttachments(
      [new File(["bad"], "bad.txt"), new File(["good"], "good.txt")],
      () => false,
    ),
  );

  expect(addReference).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ name: "good.txt", source: "imports" }),
    isCurrent,
  );
  expect(setError).toHaveBeenLastCalledWith("bad.txt：格式不支持");
  expect(result.current.importing).toBe(false);
});

it("uses the recovered run to stop it and aborts its outstanding poll on unmount", async () => {
  const running: RunDetail = {
    run: {
      id: "run",
      conversation_id: "chat",
      status: "running",
      model_id: "",
      partial_text: "",
    },
    events: [],
  };
  let pollSignal: AbortSignal | null | undefined;
  let completePoll!: (value: RunDetail) => void;
  vi.mocked(fetchApiJson)
    .mockReset()
    .mockImplementation((path, init) => {
      if (path === "/v1/amadeus/runs/active")
        return Promise.resolve(running) as never;
      if (path.endsWith("/cancel")) return Promise.resolve({}) as never;
      pollSignal = init?.signal;
      return new Promise<RunDetail>((resolve) => {
        completePoll = resolve;
      }) as never;
    });
  const acceptRun = vi.fn();
  const showAvatarState = vi.fn();
  const input: Parameters<typeof useAmadeusRun>[0] = {
    owner: "owner",
    conversations: {
      getDetail: () => null,
      open: vi.fn(),
      openRecoveredRun: vi.fn(),
      refreshList: vi.fn(),
      acceptRun,
      updateDetail: vi.fn(),
      draft: "",
      references: [],
      loaded: [],
      captureSelection: () => () => true,
      selectionPending: () => false,
      adopt: vi.fn(),
      clearDraft: vi.fn(),
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
    showAvatarState,
  };
  const view = renderHook(() => useAmadeusRun(input));
  await waitFor(() => expect(pollSignal).toBeDefined());
  act(() => view.result.current.stop());
  expect(fetchApiJson).toHaveBeenCalledWith(
    "/v1/amadeus/conversations/chat/runs/run/cancel",
    { method: "POST" },
  );
  view.unmount();
  expect(pollSignal?.aborted).toBe(true);
  await act(async () => {
    completePoll({ ...running, run: { ...running.run, status: "completed" } });
  });
  expect(acceptRun).not.toHaveBeenCalled();
  expect(showAvatarState).not.toHaveBeenCalled();
});
