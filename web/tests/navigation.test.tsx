import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { parsePage, pathFor } from "@app/routes";
import { StudioSidebar } from "@app/layout/StudioSidebar";
import { DocsApp } from "../src/docs/DocsApp";

test("renders tool navigation before the base model group", () => {
  const navigate = vi.fn();
  render(<StudioSidebar page="model-service" navigate={navigate} />);
  expect(screen.getByText("未来道具研究所")).toBeInTheDocument();
  const navigationButtons = within(screen.getByRole("navigation")).getAllByRole(
    "button",
  );
  expect(navigationButtons[0]).toHaveTextContent("工具导航");
  expect(navigationButtons[1]).toHaveTextContent("基模型");
  fireEvent.click(screen.getByRole("button", { name: "工具导航" }));
  expect(navigate).toHaveBeenCalledWith("tools");
  expect(screen.getByRole("button", { name: "基模型" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: /模型测试/ }));
  expect(navigate).toHaveBeenCalledWith("model-test");
  fireEvent.click(screen.getByRole("button", { name: /模型调用日志/ }));
  expect(navigate).toHaveBeenCalledWith("model-call-logs");
  fireEvent.click(screen.getByRole("button", { name: "基模型" }));
  expect(
    screen.queryByRole("group", { name: "基模型子菜单" }),
  ).not.toBeInTheDocument();
});

test("uses tools as the default studio route", () => {
  expect(parsePage("/")).toBe("tools");
  expect(parsePage("/unknown")).toBe("tools");
  expect(parsePage("/tools")).toBe("tools");
  expect(pathFor("tools")).toBe("/tools");
  expect(pathFor("model-service")).toBe("/model-service");
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
