import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { CardLibraryGroups } from "@features/visual-workshop/creative/CardLibraryGroups";
import {
  cardImageGroups,
  uniqueCardImageCount,
} from "@features/visual-workshop/creative/cardImages";
import { libraryFamilies } from "@features/visual-workshop/creative/cardFamilies";
import type { Card, CardKind } from "@features/visual-workshop/creative/api";
import * as api from "@features/visual-workshop/api";

vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: (path?: string) => ({
    url: path ? `blob:${path}` : "",
    loading: false,
    error: null,
  }),
}));
afterEach(() => vi.restoreAllMocks());

function card(id: string, data: Partial<Card> = {}): Card {
  return {
    id,
    title: id,
    kind: "character",
    revision: 1,
    design: "",
    archived: false,
    ...data,
  };
}
const task = (
  id: string,
  status: api.GenerationTask["status"],
  result?: string,
) => ({ id, status, result_asset_id: result }) as api.GenerationTask;

function setup(
  cards: Card[],
  search = "",
  includeArchived = false,
  kind: CardKind = "character",
) {
  const open = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CardLibraryGroups
        families={libraryFamilies(cards, kind, includeArchived, search, true)}
        galleryFamilies={libraryFamilies(
          cards,
          kind,
          includeArchived,
          "",
          true,
        )}
        onOpen={open}
        onVariant={vi.fn()}
        readOnly
        busy={false}
      />
    </QueryClientProvider>,
  );
  return { open, client };
}

test("only explicit images and completed outputs count; adopted comes first and parent references stay separate", () => {
  const main = card("主卡", {
    adopted_asset_id: "shared",
    candidate_asset_ids: ["shared", "ref", "ref"],
  });
  const child = card("变体", {
    parent_id: main.id,
    parent_asset_id: "shared",
    candidate_asset_ids: ["ref"],
    candidate_task_ids: ["done", "pending", "failed", "missing", "no-result"],
  });
  const before = JSON.stringify([main, child]);
  const groups = cardImageGroups(
    [main, child],
    new Map([
      ["done", task("done", "completed", "generated")],
      ["pending", task("pending", "processing", "unfinished")],
      ["failed", task("failed", "failed", "invalid")],
      ["no-result", task("no-result", "completed")],
    ]),
  );
  expect(groups[0].images).toEqual([
    { assetId: "shared", adopted: true },
    { assetId: "ref", adopted: false },
  ]);
  expect(groups[1].images).toEqual([
    { assetId: "ref", adopted: false },
    { assetId: "generated", adopted: false },
  ]);
  expect(uniqueCardImageCount(groups)).toBe(3);
  expect(JSON.stringify([main, child])).toBe(before);
});

test.each(["character", "scene", "prop"] as const)(
  "%s gallery includes the entire family despite search and respects archived visibility",
  async (kind) => {
    const main = card("主卡", { kind, adopted_asset_id: "adopted" });
    const a = card("主卡 · 常服", {
      kind,
      parent_id: main.id,
      adopted_asset_id: "variant",
      candidate_asset_ids: ["reference"],
    });
    const b = card("主卡 · 帽子", {
      kind,
      parent_id: a.id,
      candidate_asset_ids: ["hat"],
    });
    const archived = card("旧版", {
      kind,
      parent_id: main.id,
      candidate_asset_ids: ["old"],
      archived: true,
    });
    const { open } = setup([main, a, b, archived], "常服", false, kind);
    const trigger = screen.getByRole("button", {
      name: "查看主卡的全部关联图片",
    });
    expect(trigger).toHaveTextContent("查看全部图片（4）");
    await userEvent.click(trigger);
    const gallery = screen.getByRole("dialog", { name: "主卡的全部关联图片" });
    expect(
      within(gallery)
        .getAllByRole("heading", { level: 3 })
        .map((el) => el.textContent),
    ).toEqual(["主卡", "主卡 · 常服", "主卡 · 帽子"]);
    expect(
      within(gallery).getByRole("region", { name: "主卡 · 帽子的关联图片" }),
    ).toBeVisible();
    expect(
      within(gallery).queryByRole("region", { name: "旧版的关联图片" }),
    ).not.toBeInTheDocument();
    const section = within(gallery).getByRole("region", {
      name: "主卡 · 常服的关联图片",
    });
    expect(within(section).getByText("参考图")).toBeVisible();
    expect(within(section).getByText("已采用")).toBeVisible();
    await userEvent.click(
      within(section).getByRole("button", { name: "打开设定卡" }),
    );
    expect(open).toHaveBeenCalledWith(a.id);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  },
);

test("image preview has an original link, retries failed decodes, and Escape closes only the preview", async () => {
  const main = card("角色", {
    adopted_asset_id: "cover",
    candidate_asset_ids: ["ref"],
  });
  setup([main]);
  const trigger = screen.getByRole("button", {
    name: "查看角色的全部关联图片",
  });
  await userEvent.click(trigger);
  const bigImage = screen.getByRole("button", { name: "查看大图 角色 2" });
  await userEvent.click(bigImage);
  const preview = screen.getByRole("dialog", { name: "角色的图片预览" });
  expect(
    within(preview).getByRole("link", { name: "查看原图" }),
  ).toHaveAttribute("href", "/v1/files/ref/content");
  fireEvent.error(within(preview).getByRole("img", { name: "角色的参考图" }));
  expect(within(preview).getByRole("alert")).toHaveTextContent(
    "图片暂时无法读取",
  );
  await userEvent.click(
    within(preview).getByRole("button", { name: /^重试$/ }),
  );
  expect(
    within(preview).getByRole("img", { name: "角色的参考图" }),
  ).toBeVisible();
  fireEvent(preview, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(
    screen.queryByRole("dialog", { name: "角色的图片预览" }),
  ).not.toBeInTheDocument();
  expect(bigImage).toHaveFocus();
  const gallery = screen.getByRole("dialog", { name: "角色的全部关联图片" });
  fireEvent(gallery, new Event("cancel", { cancelable: true }));
  expect(trigger).toHaveFocus();
});

test("task results load only on open, failed reads retry, and completed results remain in counts on close", async () => {
  const load = vi
    .spyOn(api, "getGenerationTask")
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValue(task("t", "completed", "generated"));
  const main = card("角色", {
    adopted_asset_id: "cover",
    candidate_task_ids: ["t"],
  });
  setup([main]);
  expect(load).not.toHaveBeenCalled();
  const trigger = screen.getByRole("button", {
    name: "查看角色的全部关联图片",
  });
  expect(trigger).toHaveTextContent("1+");
  await userEvent.click(trigger);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "部分候选生成结果读取失败",
  );
  expect(screen.getByRole("button", { name: "查看大图 角色 1" })).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "重试读取候选结果" }),
  );
  expect(
    await screen.findByRole("button", { name: "查看大图 角色 2" }),
  ).toBeVisible();
  expect(load).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole("button", { name: "关闭图片总览" }));
  expect(trigger).toHaveTextContent("查看全部图片（2）");
});

test("archived cards remain explicit and empty cards can still be inspected", async () => {
  const main = card("主卡");
  const archived = card("旧版", { parent_id: main.id, archived: true });
  setup([main, archived], "", true);
  await userEvent.click(
    screen.getByRole("button", { name: "查看主卡的全部关联图片" }),
  );
  const section = screen.getByRole("region", { name: "旧版的关联图片" });
  expect(within(section).getByText(/已归档/)).toBeVisible();
  expect(within(section).getByText("暂无关联图片")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /创建变体/ }),
  ).not.toBeInTheDocument();
});

test("closing the gallery aborts its pending task read", async () => {
  let signal: AbortSignal | undefined;
  vi.spyOn(api, "getGenerationTask").mockImplementation(
    (_id, requestSignal) => {
      signal = requestSignal;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    },
  );
  setup([card("角色", { candidate_task_ids: ["pending"] })]);
  await userEvent.click(
    screen.getByRole("button", { name: "查看角色的全部关联图片" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("正在读取候选生成结果");
  expect(signal?.aborted).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "关闭图片总览" }));
  expect(signal?.aborted).toBe(true);
});
