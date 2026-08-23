import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { parsePage, pathFor } from "@app/routes";
import { StudioSidebar } from "@app/layout/StudioSidebar";
import { GalgameWorkshopShell } from "@app/layout/GalgameWorkshopShell";
import { VisualWorkshopShell } from "@app/layout/VisualWorkshopShell";
import { DocsApp } from "../src/docs/DocsApp";

test("renders integrations after tools and before the base model group", () => {
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
  expect(navigationButtons[4]).toHaveTextContent("集成中心");
  expect(navigationButtons[5]).toHaveTextContent("基模型");
  fireEvent.click(screen.getByRole("button", { name: "首页" }));
  expect(navigate).toHaveBeenCalledWith("home");
  fireEvent.click(screen.getByRole("button", { name: "AI应用" }));
  expect(navigate).toHaveBeenCalledWith("apps");
  fireEvent.click(screen.getByRole("button", { name: "文件管理" }));
  expect(navigate).toHaveBeenCalledWith("files");
  fireEvent.click(screen.getByRole("button", { name: "工具导航" }));
  expect(navigate).toHaveBeenCalledWith("tools");
  fireEvent.click(screen.getByRole("button", { name: "集成中心" }));
  expect(navigate).toHaveBeenCalledWith("integrations-tool-apis");
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
  expect(parsePage("/tools/video-frame-exporter")).toBe("video-frame-exporter");
  expect(parsePage("/tools/audio-annotation")).toBe(
    "audio-annotation-projects",
  );
  expect(parsePage("/tools/audio-annotation/project-1")).toBe(
    "audio-annotation-editor",
  );
  expect(parsePage("/integrations")).toBe("integrations-tool-apis");
  expect(parsePage("/integrations/tool-apis")).toBe("integrations-tool-apis");
  expect(parsePage("/integrations/mcp")).toBe("integrations-mcp");
  expect(parsePage("/integrations/skills")).toBe("integrations-skills");
  expect(pathFor("home")).toBe("/home");
  expect(pathFor("tools")).toBe("/tools");
  expect(pathFor("video-frame-exporter")).toBe("/tools/video-frame-exporter");
  expect(pathFor("audio-annotation-projects")).toBe("/tools/audio-annotation");
  expect(pathFor("audio-annotation-editor", "project-1")).toBe(
    "/tools/audio-annotation/project-1",
  );
  expect(pathFor("files")).toBe("/files");
  expect(pathFor("integrations-tool-apis")).toBe("/integrations/tool-apis");
  expect(pathFor("integrations-mcp")).toBe("/integrations/mcp");
  expect(pathFor("integrations-skills")).toBe("/integrations/skills");
  expect(pathFor("visual-workshop-canvas", "project-1")).toBe(
    "/apps/visual-workshop/projects/project-1/canvas",
  );
  expect(pathFor("visual-workshop-tasks")).toBe("/apps/visual-workshop/tasks");
  expect(pathFor("galgame-workshop-editor", "project-1")).toBe(
    "/apps/galgame-workshop/projects/project-1/editor",
  );
  expect(pathFor("model-service")).toBe("/model-service");
});

test("keeps tool navigation active on the video frame exporter", () => {
  render(<StudioSidebar page="video-frame-exporter" navigate={vi.fn()} />);
  expect(screen.getByRole("button", { name: "工具导航" })).toHaveAttribute(
    "aria-current",
    "page",
  );
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

test("renders and searches the documentation center", () => {
  window.history.replaceState({}, "", "/docs.html");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  render(<DocsApp />);
  expect(
    screen.getByRole("heading", { name: "未来道具研究所使用指南" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "返回 Studio" })).toHaveAttribute(
    "href",
    "/model-service",
  );
  expect(screen.getByRole("group", { name: "外观模式" })).toBeInTheDocument();
  expect(
    screen.getByRole("complementary", { name: "本页目录" }),
  ).toBeInTheDocument();

  fireEvent.change(screen.getByRole("searchbox", { name: "搜索使用指南" }), {
    target: { value: "波纹" },
  });
  const directory = screen.getByRole("complementary", { name: "功能目录" });
  expect(
    within(directory).getByRole("link", { name: "剧情时间轴" }),
  ).toBeInTheDocument();
  expect(
    within(directory).queryByRole("link", { name: "视频生成" }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(directory).getByRole("link", { name: "剧情时间轴" }));
  expect(
    screen.getByRole("heading", { name: "剧情时间轴", level: 1 }),
  ).toBeInTheDocument();
  expect(window.location.search).toBe("?page=galgame-timeline");

  fireEvent.click(screen.getByRole("button", { name: "打开功能目录" }));
  expect(directory).toHaveClass("open");
  fireEvent.click(screen.getAllByRole("button", { name: "关闭功能目录" })[0]!);
  expect(directory).not.toHaveClass("open");
});

test("opens documentation deep links and follows browser navigation", () => {
  window.history.replaceState(
    {},
    "",
    "/docs.html?page=visual-video#input-modes",
  );
  render(<DocsApp />);
  expect(
    screen.getByRole("heading", { name: "视频生成", level: 1 }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "四种输入方式" })).toHaveAttribute(
    "href",
    "#input-modes",
  );

  window.history.pushState({}, "", "/docs.html?page=galgame-preview-report");
  fireEvent.popState(window);
  expect(
    screen.getByRole("heading", { name: "试玩与线路检查", level: 1 }),
  ).toBeInTheDocument();
});
