import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextPanel } from "../../src/features/amadeus/ContextPanel";
import type { Context } from "../../src/features/amadeus/protocol";

const context = (
  windowId: number,
  overrides: Partial<Context> = {},
): Context => ({
  windowId,
  application: "研究所",
  title: `页面 ${windowId}`,
  path: `/page/${windowId}`,
  focused: false,
  ...overrides,
});

describe("Amadeus current context panel", () => {
  it("shows an empty state when no Studio window is available", () => {
    render(<ContextPanel items={[]} />);
    expect(screen.getByText("0 个窗口")).toBeInTheDocument();
    expect(screen.getByText("暂未连接研究所窗口")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "收起当前上下文" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "展开全部" })).toBeNull();
  });

  it("collapses the whole context card independently of its window details", () => {
    const view = render(
      <ContextPanel items={[context(1, { focused: true })]} />,
    );
    expect(screen.getByText("页面 1")).toBeInTheDocument();
    expect(screen.queryByText("1 个窗口")).toBeNull();
    expect(screen.queryByText("活动窗口")).toBeNull();
    expect(screen.queryByText("暂无选中控件")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "收起当前上下文" }));
    expect(
      screen.getByRole("button", { name: "展开当前上下文" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("页面 1")).not.toBeVisible();
    view.rerender(<ContextPanel items={[context(1), context(2)]} />);
    expect(
      screen.getByRole("button", { name: "展开当前上下文" }),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "展开当前上下文" }));
    expect(screen.getByText("页面 1")).toBeVisible();
  });

  it("shows only useful window details without a second toggle", () => {
    const items = [
      context(1, {
        application: "视觉创作工坊",
        title: "秋日晚霞",
        path: "/visual-workshop/projects/scene",
        selection: { name: "人物高光", value: "图层 12" },
        focused: true,
        unsaved: true,
      }),
      context(2),
    ];
    render(<ContextPanel items={items} />);
    expect(screen.queryByRole("button", { name: "收起详情" })).toBeNull();
    expect(screen.getByText("秋日晚霞")).toBeInTheDocument();
    expect(screen.getByText("秋日晚霞").closest("article")).toHaveAttribute(
      "title",
      "/visual-workshop/projects/scene",
    );
    expect(screen.getByText("人物高光 · 图层 12")).toBeInTheDocument();
    expect(screen.getByLabelText("活动窗口")).toBeInTheDocument();
    expect(screen.getByText("未保存")).toBeInTheDocument();
    expect(screen.getByText("页面 2")).toBeInTheDocument();
    expect(screen.queryByText("暂无选中控件")).toBeNull();
    expect(screen.getByText("2 个窗口")).toBeInTheDocument();
  });

  it("summarizes longer context and expands windows with the active one first", () => {
    const items = [
      context(1, { application: "演示工坊", title: "第一份演示" }),
      context(2, { application: "思绪工坊", title: "项目笔记" }),
      context(3, {
        application: "视觉创作工坊",
        title: "很长的项目标题 · 跨场景视觉设定和第二轮修订记录",
        focused: true,
        unsaved: true,
        selection: { name: "人物高光", value: "图层 12" },
      }),
      context(4, { application: "演示工坊", title: "第二份演示" }),
    ];
    render(<ContextPanel items={items} />);
    expect(screen.getByText("4 个窗口")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开全部" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("其余 3 个窗口")).toBeInTheDocument();
    expect(screen.getByText("人物高光 · 图层 12")).toBeInTheDocument();
    expect(screen.queryByText("第一份演示")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开全部" }));
    const details = screen.getByRole("region", { name: "窗口上下文详情" });
    expect(screen.getByRole("button", { name: "收起详情" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(details).getAllByRole("article")[0]).toHaveTextContent(
      "很长的项目标题",
    );
    expect(within(details).getByText("第二份演示")).toBeInTheDocument();
  });

  it("preserves the long-list choice until its density tier changes", () => {
    const one = [context(1)];
    const two = [context(1), context(2)];
    const three = [context(1), context(2), context(3)];
    const four = [...three, context(4)];
    const view = render(<ContextPanel items={one} />);
    view.rerender(<ContextPanel items={two} />);
    expect(screen.queryByRole("button", { name: "展开全部" })).toBeNull();
    view.rerender(<ContextPanel items={three} />);
    expect(screen.getByRole("button", { name: "展开全部" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "展开全部" }));
    view.rerender(<ContextPanel items={four} />);
    expect(screen.getByRole("button", { name: "收起详情" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    view.rerender(<ContextPanel items={two} />);
    expect(screen.queryByRole("button", { name: "收起详情" })).toBeNull();
  });

  it("uses current bridge data and falls back to the first window if none is focused", () => {
    const view = render(
      <ContextPanel
        items={[
          context(1, { title: undefined, application: "研究所" }),
          context(2),
          context(3),
        ]}
      />,
    );
    expect(screen.getByText("/page/1")).toBeInTheDocument();
    view.rerender(
      <ContextPanel
        items={[
          context(1, {
            application: "研究所",
            title: "集成中心 · Skills",
            selection: { name: "能力", value: "MCP" },
          }),
          context(2),
          context(3),
        ]}
      />,
    );
    expect(screen.getByText("集成中心 · Skills")).toBeInTheDocument();
    expect(screen.getByText("能力 · MCP")).toBeInTheDocument();
  });
});
