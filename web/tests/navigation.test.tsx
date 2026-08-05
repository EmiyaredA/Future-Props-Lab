import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { parsePage, pathFor } from "@app/routes";
import { StudioSidebar } from "@app/layout/StudioSidebar";
import { GalgameWorkshopShell } from "@app/layout/GalgameWorkshopShell";
import { VisualWorkshopShell } from "@app/layout/VisualWorkshopShell";
import { DocsApp } from "../src/docs/DocsApp";

test("renders home, applications, files, tools, then the base model group", () => {
  const navigate = vi.fn();
  render(<StudioSidebar page="model-service" navigate={navigate} />);
  expect(screen.getByText("未来道具研究所")).toBeInTheDocument();
  const navigationButtons = within(screen.getByRole("navigation")).getAllByRole(
    "button",
  );
  expect(navigationButtons[0]).toHaveTextContent("首页");
  expect(navigationButtons[1]).toHaveTextContent("AI应用");
  expect(navigationButtons[2]).toHaveTextContent("文件管理");
  expect(navigationButtons[3]).toHaveTextContent("工具导航");
  expect(navigationButtons[4]).toHaveTextContent("基模型");
  fireEvent.click(screen.getByRole("button", { name: "首页" }));
  expect(navigate).toHaveBeenCalledWith("home");
  fireEvent.click(screen.getByRole("button", { name: "AI应用" }));
  expect(navigate).toHaveBeenCalledWith("apps");
  fireEvent.click(screen.getByRole("button", { name: "文件管理" }));
  expect(navigate).toHaveBeenCalledWith("files");
  fireEvent.click(screen.getByRole("button", { name: "工具导航" }));
  expect(navigate).toHaveBeenCalledWith("tools");
  expect(screen.getByRole("button", { name: "基模型" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByRole("button", { name: "文档中心" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /模型测试/ }));
  expect(navigate).toHaveBeenCalledWith("model-test");
  fireEvent.click(screen.getByRole("button", { name: /模型调用日志/ }));
  expect(navigate).toHaveBeenCalledWith("model-call-logs");
  fireEvent.click(screen.getByRole("button", { name: "基模型" }));
  expect(
    screen.queryByRole("group", { name: "基模型子菜单" }),
  ).not.toBeInTheDocument();
});

test("uses home as the default and parses deep application routes", () => {
  expect(parsePage("/")).toBe("home");
  expect(parsePage("/unknown")).toBe("home");
  expect(parsePage("/home")).toBe("home");
  expect(parsePage("/apps")).toBe("apps");
  expect(parsePage("/apps/visual-workshop/projects/project-1/assets")).toBe(
    "visual-workshop-assets",
  );
  expect(parsePage("/apps/galgame-workshop/projects/project-1/editor")).toBe(
    "galgame-workshop-editor",
  );
  expect(parsePage("/files")).toBe("files");
  expect(parsePage("/tools")).toBe("tools");
  expect(pathFor("home")).toBe("/home");
  expect(pathFor("tools")).toBe("/tools");
  expect(pathFor("files")).toBe("/files");
  expect(pathFor("visual-workshop-canvas", "project-1")).toBe(
    "/apps/visual-workshop/projects/project-1/canvas",
  );
  expect(pathFor("visual-workshop-tasks")).toBe("/apps/visual-workshop/tasks");
  expect(pathFor("galgame-workshop-editor", "project-1")).toBe(
    "/apps/galgame-workshop/projects/project-1/editor",
  );
  expect(pathFor("model-service")).toBe("/model-service");
});

test("renders the visual workshop brand and return card", () => {
  const navigate = vi.fn();
  const onBack = vi.fn();
  const { container } = render(
    <VisualWorkshopShell
      page="visual-workshop-projects"
      navigate={navigate}
      onBack={onBack}
    >
      <div>项目内容</div>
    </VisualWorkshopShell>,
  );
  expect(container.querySelector(".workshop-brand img")).toHaveAttribute(
    "src",
    "/brand/visual-workshop-mark.png",
  );
  expect(screen.getByText("浏览全部 AI 应用")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "返回应用中心" }));
  expect(onBack).toHaveBeenCalledOnce();
});

test("renders the Galgame workshop brand", () => {
  const { container } = render(
    <GalgameWorkshopShell
      page="galgame-workshop-projects"
      navigate={vi.fn()}
      onBack={vi.fn()}
    >
      <div>Galgame 项目内容</div>
    </GalgameWorkshopShell>,
  );
  expect(container.querySelector(".workshop-brand img")).toHaveAttribute(
    "src",
    "/brand/galgame-workshop-mark.png",
  );
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
