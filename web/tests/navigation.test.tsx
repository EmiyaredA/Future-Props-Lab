import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { parsePage, parseRoute, pathFor } from "@app/routes";
import { StudioShell, StudioSidebar } from "@app/layout/StudioSidebar";
import { WorkshopShell } from "@app/layout/WorkshopShell";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { GALGAME_WORKSHOP_MODULE } from "@features/galgame-workshop/module";
import { VIDEO_EDITOR_MODULE } from "@features/video-editor/module";
import { VISUAL_WORKSHOP_MODULE } from "@features/visual-workshop/module";
import { DocsApp } from "../src/docs/DocsApp";

function openDocsSearch() {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  fireEvent.click(screen.getByRole("button", { name: "搜索文档" }));
  return screen.getByRole("dialog", { name: "搜索文档" });
}

test("renders integrations after tools and before the base model group", () => {
  const navigate = vi.fn();
  render(
    <StudioShell page="model-service" navigate={navigate}>
      <div>内容</div>
    </StudioShell>,
  );
  expect(
    document.querySelector(".studio-collapsed-rail__brand .brand-mark"),
  ).toBeTruthy();
  expect(document.querySelector(".studio-shell .studio-stage")).not.toBeNull();
  expect(
    document.querySelectorAll(".studio-shell > .studio-panel").length,
  ).toBe(1);
  expect(
    document.querySelectorAll(".studio-stage > .studio-panel").length,
  ).toBe(2);
  const navigation = screen.getByRole("navigation", { name: "栏目导航" });
  const navigationButtons = within(navigation).getAllByRole("button");
  expect(navigationButtons[0]).toHaveAccessibleName("首页");
  expect(navigationButtons[1]).toHaveAccessibleName("AI应用");
  expect(navigationButtons[2]).toHaveAccessibleName("文件管理");
  expect(navigationButtons[3]).toHaveAccessibleName("工具导航");
  expect(navigationButtons[4]).toHaveAccessibleName("集成中心");
  expect(navigationButtons[5]).toHaveAccessibleName("基模型");
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
  expect(
    screen.getByRole("navigation", { name: "基模型子菜单" }),
  ).toBeInTheDocument();
  expect(
    document.querySelector(".studio-sidebar.has-secondary .studio-secondary"),
  ).not.toBeNull();
  expect(screen.getByRole("link", { name: "文档中心" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /模型测试/ }));
  expect(navigate).toHaveBeenCalledWith("model-test");
  fireEvent.click(screen.getByRole("button", { name: /测试工具/ }));
  expect(navigate).toHaveBeenCalledWith("model-test-tools");
  fireEvent.click(screen.getByRole("button", { name: /模型调用日志/ }));
  expect(navigate).toHaveBeenCalledWith("model-call-logs");
  fireEvent.click(screen.getByRole("button", { name: "收起二级导航" }));
  expect(
    screen.queryByRole("navigation", { name: "基模型子菜单" }),
  ).not.toBeInTheDocument();
});

test("keeps floating chrome panels as three shell blocks", () => {
  const { container } = render(
    <StudioShell page="home" navigate={vi.fn()}>
      <div>首页内容</div>
    </StudioShell>,
  );
  expect(container.querySelector(".studio-shell")).not.toBeNull();
  expect(
    container.querySelector(".studio-sidebar.studio-panel"),
  ).not.toBeNull();
  expect(
    container.querySelector(
      ".studio-stage > .studio-global-header.studio-panel",
    ),
  ).not.toBeNull();
  expect(
    container.querySelector(".studio-stage > .studio-main.studio-panel"),
  ).not.toBeNull();
  expect(container.querySelector(".studio-sidebar.has-secondary")).toBeNull();
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
  expect(parsePage("/apps/video-editor/projects/project-1/editor")).toBe(
    "video-editor-editor",
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
  expect(pathFor("video-editor-editor", "project-1")).toBe(
    "/apps/video-editor/projects/project-1/editor",
  );
  expect(pathFor("video-editor-tasks")).toBe("/apps/video-editor/tasks");
  expect(pathFor("model-service")).toBe("/model-service");
  expect(parseRoute("/model-test-tools/tool-1")).toEqual({
    page: "model-test-tools",
    projectId: "tool-1",
  });
  expect(pathFor("model-test-tools")).toBe("/model-test-tools");
  expect(pathFor("model-test-tools", "tool-1")).toBe(
    "/model-test-tools/tool-1",
  );
});

test("keeps tool navigation active on the video frame exporter", () => {
  render(<StudioSidebar page="video-frame-exporter" navigate={vi.fn()} />);
  expect(screen.getByRole("button", { name: "工具导航" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("remembers the desktop secondary sidebar collapse preference", () => {
  localStorage.removeItem("future-props-sidebar-studio-secondary-collapsed");
  const { unmount } = render(
    <StudioSidebar page="model-service" navigate={vi.fn()} />,
  );

  expect(screen.getByRole("button", { name: "收起二级导航" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "收起二级导航" }));
  expect(
    localStorage.getItem("future-props-sidebar-studio-secondary-collapsed"),
  ).toBe("true");
  expect(
    screen.getByRole("button", { name: "展开二级导航" }),
  ).toBeInTheDocument();

  unmount();
  render(<StudioSidebar page="model-service" navigate={vi.fn()} />);
  expect(
    screen.getByRole("button", { name: "展开二级导航" }),
  ).toBeInTheDocument();
  localStorage.removeItem("future-props-sidebar-studio-secondary-collapsed");
});

test("keeps brand mark above the secondary toggle in the primary rail", () => {
  localStorage.removeItem("future-props-sidebar-studio-secondary-collapsed");
  const { container } = render(
    <StudioSidebar page="model-service" navigate={vi.fn()} />,
  );
  const top = container.querySelector(".studio-collapsed-rail__top");
  expect(top).not.toBeNull();
  expect(top?.querySelector(".brand-mark")).toHaveAttribute(
    "src",
    "/brand/brand-mark.png",
  );
  expect(
    top?.querySelector(".studio-collapsed-rail__brand")?.nextElementSibling,
  ).toHaveAttribute("data-tip", "收起二级导航");
  expect(screen.getByRole("button", { name: "收起二级导航" })).toBeEnabled();
});

test("hides secondary toggle when the viewport forces the icon rail", () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width: 1200px"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  })) as typeof window.matchMedia;

  const { container } = render(
    <StudioSidebar page="model-service" navigate={vi.fn()} />,
  );
  expect(
    container.querySelector(".studio-collapsed-rail__brand .brand-mark"),
  ).not.toBeNull();
  expect(
    screen.queryByRole("button", { name: "收起二级导航" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "展开二级导航" }),
  ).not.toBeInTheDocument();

  window.matchMedia = originalMatchMedia;
});

test("hides secondary toggle on leaf pages without secondary navigation", () => {
  render(<StudioSidebar page="files" navigate={vi.fn()} />);
  expect(
    screen.queryByRole("button", { name: "收起二级导航" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "展开二级导航" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "当前分区无二级导航" }),
  ).not.toBeInTheDocument();
});

test("opens base-model flyout from the primary rail when secondary is hidden", () => {
  localStorage.setItem(
    "future-props-sidebar-studio-secondary-collapsed",
    "true",
  );
  const navigate = vi.fn();
  render(<StudioSidebar page="home" navigate={navigate} />);

  fireEvent.click(screen.getByRole("button", { name: "基模型，点击展开菜单" }));
  const menu = screen.getByRole("menu", { name: "基模型" });
  expect(menu).toBeInTheDocument();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "模型服务" }));
  expect(navigate).toHaveBeenCalledWith("model-service");
  expect(
    screen.queryByRole("menu", { name: "基模型" }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "基模型，点击展开菜单" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(
    screen.queryByRole("menu", { name: "基模型" }),
  ).not.toBeInTheDocument();
  localStorage.removeItem("future-props-sidebar-studio-secondary-collapsed");
});

test("treats integration center as a leaf without secondary navigation", () => {
  const navigate = vi.fn();
  render(<StudioSidebar page="integrations-mcp" navigate={navigate} />);
  expect(
    screen.queryByRole("navigation", { name: "集成中心子菜单" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "集成中心" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  fireEvent.click(screen.getByRole("button", { name: "集成中心" }));
  expect(navigate).not.toHaveBeenCalled();
});

test("renders the visual workshop brand and return card", () => {
  const navigate = vi.fn();
  const onBack = vi.fn();
  const { container } = render(
    <WorkshopShell
      module={VISUAL_WORKSHOP_MODULE}
      page="visual-workshop-projects"
      navigate={navigate}
      onBack={onBack}
    >
      <WorkshopAppChrome title="项目内容" />
    </WorkshopShell>,
  );
  expect(container.querySelector(".workshop-brand img")).toHaveAttribute(
    "src",
    "/brand/visual-workshop-mark.png",
  );
  expect(screen.getByText("浏览全部 AI 应用")).toBeInTheDocument();
  expect(
    screen.getByRole("navigation", { name: "视觉创作工坊导航" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "项目工作台" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("heading", { name: "项目内容" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "外观模式" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "生成任务" }));
  expect(navigate).toHaveBeenCalledWith("visual-workshop-tasks");
  fireEvent.click(screen.getByRole("button", { name: "返回应用中心" }));
  expect(onBack).toHaveBeenCalledOnce();
});

test("renders the Galgame workshop brand", () => {
  const { container } = render(
    <WorkshopShell
      module={GALGAME_WORKSHOP_MODULE}
      page="galgame-workshop-projects"
      navigate={vi.fn()}
      onBack={vi.fn()}
    >
      <div>Galgame 项目内容</div>
    </WorkshopShell>,
  );
  expect(container.querySelector(".workshop-brand img")).toHaveAttribute(
    "src",
    "/brand/galgame-workshop-mark.png",
  );
});

test("renders the video editor shell from its module configuration", () => {
  const { container } = render(
    <WorkshopShell
      module={VIDEO_EDITOR_MODULE}
      page="video-editor-tasks"
      navigate={vi.fn()}
      onBack={vi.fn()}
    >
      <div>剪辑任务</div>
    </WorkshopShell>,
  );
  expect(container.querySelector(".workshop-brand img")).toHaveAttribute(
    "src",
    "/brand/video-editor-mark.png",
  );
  expect(
    screen.getByRole("navigation", { name: "视频剪辑工坊导航" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "渲染任务" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("renders and searches the documentation center", () => {
  window.history.replaceState({}, "", "/docs.html");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  render(<DocsApp />);
  expect(
    screen.getByRole("heading", { name: "欢迎使用未来道具研究所" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "返回 Studio" })).toHaveAttribute(
    "href",
    "/",
  );
  expect(screen.getByRole("group", { name: "外观模式" })).toBeInTheDocument();
  expect(
    screen.getByRole("complementary", { name: "本页目录" }),
  ).toBeInTheDocument();

  const results = openDocsSearch();
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索使用指南" }), {
    target: { value: "波纹" },
  });
  const directory = screen.getByRole("complementary", { name: "功能目录" });
  expect(
    within(results).getByRole("link", { name: /剧情时间轴/ }),
  ).toBeInTheDocument();
  expect(
    within(results).queryByRole("link", { name: "视频生成" }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(results).getByRole("link", { name: /剧情时间轴/ }));
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

test("includes the video editor delivery guide in documentation search", () => {
  window.history.replaceState({}, "", "/docs.html");
  render(<DocsApp />);
  const results = openDocsSearch();
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索使用指南" }), {
    target: { value: "代理" },
  });
  const link = within(results).getByRole("link", {
    name: /项目与快照/,
  });
  expect(link).toBeInTheDocument();
  fireEvent.click(link);
  expect(
    screen.getByRole("heading", { name: "项目与快照", level: 1 }),
  ).toBeInTheDocument();
  expect(window.location.search).toBe("?page=video-editor-projects");
});
