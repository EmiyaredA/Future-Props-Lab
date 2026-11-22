import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";
import {
  groupCards,
  cardRowLabel,
  libraryFamilies,
} from "@features/visual-workshop/creative/cardFamilies";
import { useCardNameSort } from "@features/visual-workshop/creative/useCardNameSort";
import { CardLibraryGroups } from "@features/visual-workshop/creative/CardLibraryGroups";
import { useCardCreation } from "@features/visual-workshop/creative/useCardCreation";
import {
  cardsKey,
  type Card,
  type CardKind,
} from "@features/visual-workshop/creative/api";
import * as cardApi from "@features/visual-workshop/creative/api";

const card = (
  id: string,
  title: string,
  parent_id?: string,
  kind: CardKind = "character",
): Card => ({
  id,
  title,
  kind,
  parent_id,
  revision: 0,
  design: "",
  archived: false,
});
test.each(["character", "scene", "prop"] as const)(
  "%s families preserve separate card identities and nested variants",
  async (kind) => {
    const root = card("root", "设定2", undefined, kind);
    const a = card("a", "造型10", root.id, kind),
      b = card("b", "造型2", a.id, kind);
    const other = card("other", "设定10", undefined, kind);
    const all = [other, a, b, root];
    const families = groupCards(all, all, true);
    expect(families.map(({ root }) => root.id)).toEqual(["root", "other"]);
    expect(families[0].items.map(({ id }) => id)).toEqual(["root", "b", "a"]);
    expect(groupCards(all, [a], true)[0].items.map(({ id }) => id)).toEqual([
      "a",
    ]);
    const open = vi.fn();
    render(
      <CardLibraryGroups
        families={families}
        onOpen={open}
        onVariant={vi.fn()}
        readOnly={false}
        busy={false}
      />,
    );
    expect(screen.getAllByRole("group", { name: /设定组$/ })).toHaveLength(2);
    await userEvent.click(
      screen.getByRole("button", { name: "查看变体 造型2" }),
    );
    expect(open).toHaveBeenCalledWith("b");
  },
);

test("search and archive filtering keep active variants under archived parent context", () => {
  const root = { ...card("root", "实验室"), archived: true };
  const a = card("a", "夜景", root.id),
    b = card("b", "日景", root.id);
  const all = [root, a, b];
  expect(
    libraryFamilies(all, "character", false, "实验室", true)[0].items,
  ).toEqual([b, a]);
  expect(
    libraryFamilies(all, "character", false, "夜景", true)[0].items,
  ).toEqual([a]);
  expect(libraryFamilies(all, "character", true, "", true)[0].items[0]).toEqual(
    root,
  );
  const orphan = card("orphan", "孤立", "missing");
  expect(groupCards([orphan], [orphan], true)[0].root).toEqual(orphan);
});

test("sorting preferences survive remount and isolate account, project and kind", () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AccountAccessProvider userId="account-a" permissions={[]}>
        {children}
      </AccountAccessProvider>
    );
  }
  const first = renderHook(() => useCardNameSort("project:a"), { wrapper });
  act(() => first.result.current.sort("scene"));
  first.unmount();
  const second = renderHook(() => useCardNameSort("project:a"), { wrapper });
  expect(second.result.current.sorted("scene")).toBe(true);
  expect(second.result.current.sorted("character")).toBe(false);
  expect(
    renderHook(() => useCardNameSort("project:b"), {
      wrapper,
    }).result.current.sorted("scene"),
  ).toBe(false);
  function other({ children }: { children: React.ReactNode }) {
    return (
      <AccountAccessProvider userId="account-b" permissions={[]}>
        {children}
      </AccountAccessProvider>
    );
  }
  expect(
    renderHook(() => useCardNameSort("project:a"), {
      wrapper: other,
    }).result.current.sorted("scene"),
  ).toBe(false);
});

test("project attachment retries reuse the created variant without creating another card", async () => {
  const parent = { ...card("parent", "角色"), adopted_asset_id: "image" };
  const child = card("child", "角色 · 变体", parent.id);
  const create = vi.spyOn(cardApi, "createCard").mockResolvedValue(child);
  const attach = vi
    .fn()
    .mockRejectedValueOnce(new Error("conflict"))
    .mockResolvedValueOnce(undefined);
  const open = vi.fn();
  const client = new QueryClient();
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  const hook = renderHook(
    () => useCardCreation("character", "角色卡", open, attach),
    { wrapper },
  );
  await act(() => hook.result.current.add(parent));
  expect(open).toHaveBeenCalledWith(child.id);
  expect(hook.result.current.canRetry).toBe(true);
  expect(client.getQueryData(cardsKey)).toEqual([child]);
  await act(() => hook.result.current.retry());
  expect(create).toHaveBeenCalledTimes(1);
  expect(attach).toHaveBeenNthCalledWith(2, child);
  expect(hook.result.current.error).toBe("");
  create.mockRestore();
});

test.each(["character", "scene", "prop"] as const)(
  "%s variant labels use verified ancestry without changing card titles",
  (kind) => {
    const root = card("root", "主体 · 设定", undefined, kind);
    const variant = card("variant", "主体 · 设定 · 常服 Q 版", root.id, kind);
    const nested = card(
      "nested",
      "主体 · 设定 · 常服 Q 版 · 墨镜",
      variant.id,
      kind,
    );
    const short = card("short", "夜景", root.id, kind);
    const missing = card("missing", "旧标题 · 细节", "unavailable", kind);
    const map = new Map(
      [root, variant, nested, short, missing].map((value) => [value.id, value]),
    );
    expect(cardRowLabel(root, map)).toEqual({
      name: root.title,
      variant: undefined,
    });
    expect(cardRowLabel(variant, map)).toEqual({
      name: root.title,
      variant: "常服 Q 版",
    });
    expect(cardRowLabel(nested, map)).toEqual({
      name: root.title,
      variant: "常服 Q 版 · 墨镜",
    });
    expect(cardRowLabel(short, map)).toEqual({
      name: root.title,
      variant: "夜景",
    });
    expect(cardRowLabel(missing, map)).toEqual({
      name: missing.title,
      variant: undefined,
    });
    expect(variant.title).toBe("主体 · 设定 · 常服 Q 版");
  },
);
