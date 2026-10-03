import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ProjectsPage } from "../src/features/desktop-pet/ProjectsPage";

vi.mock("../src/platform/api/client", () => ({
  api: { GET: async () => ({ data: { items: [] } }) },
  unwrap: (result: { data: unknown }) => result.data,
}));
vi.mock("../src/features/desktop-pet/api", () => ({
  listProjects: async () => ({
    items: [
      {
        id: "p1",
        title: "测试桌宠",
        sourceType: "coopanion-whale",
        updatedAt: "2026-10-03T00:00:00Z",
      },
    ],
  }),
}));

test("a search miss has its own empty state and clearing restores the existing project", async () => {
  render(<ProjectsPage onOpen={() => {}} />);
  await screen.findByRole("heading", { name: "测试桌宠" });
  await userEvent.type(
    screen.getByRole("textbox", { name: "搜索桌宠项目" }),
    "不存在",
  );
  expect(screen.getByText("没有匹配的桌宠项目")).toBeVisible();
  expect(screen.queryByText("还没有桌宠项目")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "清空搜索" }));
  expect(screen.getByRole("heading", { name: "测试桌宠" })).toBeVisible();
});
