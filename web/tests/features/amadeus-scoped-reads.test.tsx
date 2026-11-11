import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAmadeusData } from "@features/amadeus/useAmadeusData";
import type {
  Conversation,
  Detail,
  RunDetail,
} from "@features/amadeus/protocol";
import { fetchApiJson } from "@platform/api/client";
import {
  amadeusTabKey,
  readDraft,
  writeTabState,
} from "@features/amadeus/tabState";

vi.mock("@platform/api/client", () => ({ fetchApiJson: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const bridge = {
  amadeusContexts: async () => [],
  amadeusAlwaysOnTop: async () => true,
  onAmadeusContexts: () => () => undefined,
  onAmadeusReference: () => () => undefined,
  onAmadeusPickFinished: () => () => undefined,
};
const noop = vi.fn();

const isExecutingAction = () => false;

function useFixture(owner: string) {
  return useAmadeusData({
    owner,
    bridge: bridge as unknown as Parameters<typeof useAmadeusData>[0]["bridge"],
    standalone: false,
    onError: noop,
    onPickFinished: noop,
    isExecutingAction,
  });
}

describe("Amadeus scoped reads", () => {
  it("ignores a late conversation response after another conversation is selected", async () => {
    const first = deferred<Detail>();
    const second = deferred<Detail>();
    const staleWorkspace = deferred<Detail>();
    const tabKey = amadeusTabKey("one", "embedded");
    writeTabState(`${tabKey}:draft:first`, {
      text: "first draft",
      references: [],
    });
    writeTabState(`${tabKey}:draft:second`, {
      text: "second draft",
      references: [],
    });
    vi.mocked(fetchApiJson).mockImplementation(async (path) => {
      if (path === "/v1/amadeus/conversations") return { items: [] } as never;
      if (path === "/v1/amadeus/runs/active") return null as never;
      if (path === "/v1/model-inference/options") return { items: [] } as never;
      if (path.endsWith("/runs")) return [] as never;
      if (path.endsWith("/first")) return first.promise as never;
      if (path.endsWith("/second")) return second.promise as never;
      if (path.endsWith("/stale")) return staleWorkspace.promise as never;
      throw new Error(String(path));
    });
    const view = renderHook(({ workspace }) => useFixture(workspace), {
      initialProps: { workspace: "one" },
    });
    let readFirst!: Promise<RunDetail[] | undefined>;
    let readSecond!: Promise<RunDetail[] | undefined>;
    act(() => {
      readFirst = view.result.current.open("first");
      readSecond = view.result.current.open("second");
    });
    const conversation = (id: string) =>
      ({ id, revision: 1, title: id }) as Conversation;
    await act(async () => {
      second.resolve({
        conversation: conversation("second"),
        messages: [
          {
            id: "second-reply",
            role: "assistant",
            content: "second reply",
            created_at: "2026-11-09",
            references: [],
          },
        ],
        actions: [],
      });
      await readSecond;
    });
    await act(async () => {
      first.resolve({
        conversation: conversation("first"),
        messages: [],
        actions: [],
      });
      await readFirst;
    });
    expect(view.result.current.detail?.conversation.id).toBe("second");
    expect(view.result.current.detail?.messages[0].id).toBe("second-reply");
    expect(view.result.current.draft).toBe("second draft");
    let staleRead!: Promise<RunDetail[] | undefined>;
    act(() => {
      staleRead = view.result.current.open("stale");
    });
    expect(view.result.current.detail).toBeNull();
    view.rerender({ workspace: "two" });
    await act(async () => {
      staleWorkspace.resolve({
        conversation: conversation("stale"),
        messages: [],
        actions: [],
      });
      await staleRead;
    });
    await waitFor(() => expect(view.result.current.detail).toBeNull());
  });
});

it("keeps an unsent draft in the original account after changing accounts", async () => {
  vi.mocked(fetchApiJson).mockResolvedValue({ items: [] } as never);
  const view = renderHook(({ owner }) => useFixture(owner), {
    initialProps: { owner: "draft-source" },
  });
  act(() => view.result.current.setDraft("private unsent text"));
  const originalRead = view.result.current.selectionSignal();
  view.rerender({ owner: "draft-target" });
  await waitFor(() => expect(view.result.current.draft).toBe(""));
  expect(originalRead.aborted).toBe(true);
  expect(
    readDraft(`${amadeusTabKey("draft-source", "embedded")}:draft:new`).text,
  ).toBe("private unsent text");
  expect(
    readDraft(`${amadeusTabKey("draft-target", "embedded")}:draft:new`).text,
  ).toBe("");
});
