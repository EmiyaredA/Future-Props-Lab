import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { StudioSidebar } from "@app/layout/StudioSidebar";
import { DocsApp } from "../src/docs/DocsApp";

test("keeps only the base model navigation", () => {
  const navigate = vi.fn();
  render(<StudioSidebar page="model-service" navigate={navigate} />);
  expect(screen.getByText("未来道具研究所")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "基模型" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: /模型调用日志/ }));
  expect(navigate).toHaveBeenCalledWith("model-call-logs");
  fireEvent.click(screen.getByRole("button", { name: "基模型" }));
  expect(
    screen.queryByRole("group", { name: "基模型子菜单" }),
  ).not.toBeInTheDocument();
});

test("renders an intentionally empty documentation shell", () => {
  render(<DocsApp />);
  expect(
    screen.getByRole("heading", { name: "文档内容正在准备中" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "返回 Studio" })).toHaveAttribute(
    "href",
    "/model-service",
  );
  expect(screen.getByRole("group", { name: "外观模式" })).toBeInTheDocument();
});
