import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { CardCandidateImages } from "@features/visual-workshop/creative/CardCandidateImages";
import { cardCandidateIds } from "@features/visual-workshop/creative/cardImages";
import { useCardCandidates } from "@features/visual-workshop/creative/useCardCandidates";
import type { Card } from "@features/visual-workshop/creative/api";
import {
  getGenerationTask,
  type GenerationTask,
} from "@features/visual-workshop/api";

vi.mock("@features/visual-workshop/api", () => ({
  getGenerationTask: vi.fn(),
}));
const { inspect } = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock("@platform/api/client", () => ({
  api: { POST: inspect },
  unwrap: async ({ data }: { data: unknown }) => data,
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: (path?: string) => ({
    url: path ? `blob:${path}` : "",
    loading: false,
    error: null,
  }),
}));
afterEach(() => vi.restoreAllMocks());

test("legacy adopted images enter the complete list once and subsequent selections keep order", () => {
  const initial = { adopted_asset_id: "a", candidate_asset_ids: ["b", "b"] };
  const ids = cardCandidateIds(initial);
  expect(ids).toEqual(["a", "b"]);
  expect(
    cardCandidateIds({ adopted_asset_id: "b", candidate_asset_ids: ids }),
  ).toEqual(ids);
  expect(
    cardCandidateIds(
      { adopted_asset_id: "c", candidate_asset_ids: [...ids, "c"] },
      ["c", "d"],
    ),
  ).toEqual(["a", "b", "c", "d"]);
  expect(
    cardCandidateIds(initial, ["b"], new Map([["b", "library-b"]])),
  ).toEqual(["a", "library-b"]);
});

test("all pictures stay visible while selection moves, including the read-only selected label", async () => {
  const onAdopt = vi.fn();
  const props = {
    ids: ["a", "b"],
    adoptedId: "a",
    readOnly: false,
    busy: false,
    onAdopt,
  };
  const view = render(<CardCandidateImages {...props} />);
  expect(screen.getAllByRole("img")).toHaveLength(2);
  expect(screen.getByRole("status")).toHaveTextContent("已选中");
  await userEvent.click(screen.getByRole("button", { name: "采用候选图 2" }));
  expect(onAdopt).toHaveBeenCalledWith("b");
  view.rerender(<CardCandidateImages {...props} adoptedId="b" />);
  expect(screen.getAllByRole("img")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "采用候选图 1" })).toBeEnabled();
  view.rerender(<CardCandidateImages {...props} adoptedId="b" readOnly />);
  expect(screen.getAllByRole("img")).toHaveLength(2);
  expect(screen.getByRole("status")).toHaveTextContent("已选中");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("a generated project original resolves to its verified library copy after reopening", async () => {
  vi.mocked(getGenerationTask).mockResolvedValue({
    id: "task",
    status: "completed",
    result_asset_id: "project-b",
  } as GenerationTask);
  inspect.mockResolvedValue({
    data: {
      items: [
        {
          asset_id: "project-b",
          content_key: "hash",
          equivalent_ids: ["project-b", "library-b"],
        },
      ],
      unavailable_ids: [],
    },
    response: new Response(),
  });
  const card = {
    id: "card",
    kind: "character",
    title: "角色",
    revision: 1,
    design: "",
    archived: false,
    adopted_asset_id: "library-b",
    candidate_asset_ids: ["a", "library-b"],
    candidate_task_ids: ["task"],
  } as Card;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const hook = renderHook(({ value }) => useCardCandidates(value, new Map()), {
    initialProps: { value: card },
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(inspect).toHaveBeenCalled());
  await waitFor(() =>
    expect(hook.result.current.aliases.get("project-b")).toBe("library-b"),
  );
  expect(hook.result.current.ids).toEqual(["a", "library-b"]);
  inspect.mockResolvedValue({
    data: {
      items: [
        {
          asset_id: "project-b",
          content_key: "hash",
          equivalent_ids: ["project-b", "library-c"],
        },
      ],
    },
    response: new Response(),
  });
  hook.rerender({
    value: {
      ...card,
      adopted_asset_id: "library-c",
      candidate_asset_ids: ["a", "library-c"],
    },
  });
  await waitFor(() =>
    expect(hook.result.current.aliases.get("project-b")).toBe("library-c"),
  );
  expect(hook.result.current.ids).toEqual(["a", "library-c"]);
  expect(inspect).toHaveBeenCalledTimes(2);
});
