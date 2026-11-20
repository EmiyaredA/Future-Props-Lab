import { expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommonDesignCards } from "@features/visual-workshop/board/CommonDesignCards";
import { cardsKey, type Card } from "@features/visual-workshop/creative/api";

const card = (id: string, title: string, parent_id?: string): Card => ({
  id,
  title,
  kind: "character",
  parent_id,
  revision: 0,
  facts: "",
  design: "",
  proposed_design: "",
  archived: false,
});
const main = card("main", "林夏");
const variant = card("rain", "林夏 · 雨衣", main.id);

function mount(ids: string[] = [], search = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  });
  client.setQueryData(cardsKey, [main, variant]);
  const add = vi.fn();
  const source = vi.fn();
  const view = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <CommonDesignCards
        projectId="test-project"
        ids={ids}
        search={search}
        canUse={false}
        onAdd={add}
        onCreate={vi.fn()}
        sources={[
          {
            id: "legacy",
            kind: "image",
            title: "旧雨衣人设",
            design_card_id: variant.id,
            position: { x: 0, y: 0 },
          },
        ]}
        onSource={source}
        onUse={vi.fn()}
        onCanvas={vi.fn()}
        onView={view}
        onRemove={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { add, source, view };
}

test("three fixed card groups remain available when empty", async () => {
  const { add } = mount();
  for (const label of ["人设", "场景", "道具"]) {
    expect(screen.getByRole("region", { name: label })).toBeVisible();
  }
  await userEvent.click(screen.getByRole("button", { name: "添加场景卡" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "从设定库添加" }));
  expect(add).toHaveBeenCalledWith("scene");
});

test("variants group beneath the main card and expose original nodes", async () => {
  const { source } = mount([main.id, variant.id]);
  const character = screen.getByRole("region", { name: "人设" });
  expect(
    within(character).getByRole("button", { name: "查看设定卡 林夏" }),
  ).toBeVisible();
  expect(
    within(character).getByRole("button", { name: "查看设定卡 林夏 · 雨衣" }),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "林夏 · 雨衣 操作" }),
  );
  await userEvent.click(
    screen.getByRole("menuitem", { name: "来源：旧雨衣人设" }),
  );
  expect(source).toHaveBeenCalledWith("legacy");
});

test("project variants are independent rows and never inject their parent", async () => {
  const { view } = mount([variant.id]);
  const choice = screen.getByRole("button", { name: "查看设定卡 林夏 · 雨衣" });
  expect(choice.querySelector("strong")).toHaveTextContent("林夏");
  expect(choice.querySelector(".board-design-card-variant")).toHaveTextContent(
    "雨衣",
  );
  expect(screen.queryByRole("button", { name: "查看设定卡 林夏" })).toBeNull();
  expect(screen.queryByRole("group", { name: "林夏的变体" })).toBeNull();
  await userEvent.hover(choice);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("林夏 · 雨衣");
  await userEvent.click(choice);
  expect(view).toHaveBeenCalledWith(variant);
});
