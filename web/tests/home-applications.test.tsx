import { publicImageSources } from "@shared/lib/imageSources";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { APPLICATION_DEFINITIONS } from "@app/applicationRegistry";
import { ApplicationCenterPage } from "@features/applications/ApplicationCenterPage";
import { HomePage } from "@features/home/HomePage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

test("home showcases application folders and keeps test mode on navigation", async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(
    <HomePage applications={APPLICATION_DEFINITIONS} onNavigate={navigate} />,
  );
  expect(screen.getByRole("heading", { name: "AI 应用" })).toBeInTheDocument();
  const folder = screen.getByRole("button", { name: "视觉与叙事，3 个应用" });
  expect(folder).toHaveAttribute("aria-expanded", "false");
  expect(
    screen.queryByRole("button", { name: "打开视觉创作工坊" }),
  ).not.toBeInTheDocument();
  folder.focus();
  await user.keyboard("{Enter}");
  await user.keyboard("{Tab}");
  expect(
    screen.getByRole("button", { name: "打开视觉创作工坊" }),
  ).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "打开视觉创作工坊" }));
  expect(navigate).toHaveBeenCalledWith("/apps/visual-workshop");
  await user.keyboard("{Escape}");
  expect(folder).toHaveFocus();
  expect(folder).toHaveAttribute("aria-expanded", "false");
  await user.keyboard(" ");
  expect(folder).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("button", { name: "图像" }));
  await user.click(screen.getByRole("button", { name: /开始测试/ }));
  expect(navigate).toHaveBeenLastCalledWith("/model-test?mode=image");
  await user.click(screen.getByRole("button", { name: /全部应用/ }));
  expect(navigate).toHaveBeenLastCalledWith("/apps");
});

test("home resources collapse independently and host tools follow permissions", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <HomePage onNavigate={vi.fn()} canReadLogs={false} />,
  );
  const tools = container.querySelector("#home-tools")! as HTMLElement;
  const files = container.querySelector("#home-files")! as HTMLElement;
  await user.click(within(tools).getByRole("button", { name: "收起" }));
  expect(within(tools).getByRole("button", { name: "展开" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(within(files).getByRole("button", { name: "收起" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(
    screen.queryByRole("button", { name: /Codex 模型源/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /调用日志/ }),
  ).not.toBeInTheDocument();
});

test("home plays bundled Kurisu and pauses while the page is hidden", () => {
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const { container, unmount } = render(<HomePage onNavigate={vi.fn()} />);
  const video = container.querySelector("video")!;
  expect(video).toHaveAttribute(
    "src",
    publicImageSources("/brand/home/kurisu-idle.webm").src,
  );
  expect(video.loop && video.muted && video.playsInline).toBe(true);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  hidden = true;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  hidden = false;
  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  unmount();
});

test("home keeps its static poster when media fails", () => {
  const { container } = render(<HomePage onNavigate={vi.fn()} />);
  act(() =>
    container.querySelector("video")!.dispatchEvent(new Event("error")),
  );
  expect(container.querySelector("video")).toBeNull();
  expect(container.querySelector(".home-hero-pet img")).toHaveAttribute(
    "src",
    publicImageSources("/brand/home/kurisu-idle.png").src,
  );
});

test("home uses a static image under reduced motion and follows preference changes", async () => {
  let listener = () => {};
  const preference = {
    matches: true,
    addEventListener: (_: string, callback: () => void) => {
      listener = callback;
    },
    removeEventListener: vi.fn(),
  };
  vi.spyOn(window, "matchMedia").mockReturnValue(
    preference as unknown as MediaQueryList,
  );
  const { container } = render(<HomePage onNavigate={vi.fn()} />);
  expect(container.querySelector("video")).toBeNull();
  preference.matches = false;
  await act(async () => listener());
  expect(container.querySelector("video")).not.toBeNull();
});

test("home treats an interrupted play request as a pause rather than a media failure", async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
    new DOMException("Paused", "AbortError"),
  );
  const { container } = render(<HomePage onNavigate={vi.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(container.querySelector("video")).not.toBeNull();
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => {
    await Promise.resolve();
  });
  expect(container.querySelector(".home-hero-pet")).toHaveAttribute(
    "data-playing",
    "true",
  );
});

test("application center filters and records recent application access", async () => {
  const user = userEvent.setup();
  const open = vi.fn();
  render(
    <ApplicationCenterPage
      applications={APPLICATION_DEFINITIONS}
      onOpen={open}
    />,
  );
  expect(screen.getByText("还没有访问记录")).toBeInTheDocument();
  expect(APPLICATION_DEFINITIONS.map((item) => item.id)).not.toContain(
    "live2d-workshop",
  );
  expect(APPLICATION_DEFINITIONS.map((item) => item.id)).not.toContain(
    "desktop-pet",
  );
  for (const [name, asset] of [
    ["思绪工坊", "thought-workshop"],
    ["视觉创作工坊", "visual-workshop"],
    ["Galgame 工坊", "galgame-workshop"],
    ["视频剪辑工坊", "video-editor"],
  ]) {
    expect(
      screen.getByRole("button", { name: `打开${name}` }).querySelector("img"),
    ).toHaveAttribute(
      "src",
      publicImageSources(`/brand/${asset}-mark.png`).src,
    );
  }
  expect(screen.getByRole("heading", { name: "应用" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "效率协作" }));
  expect(
    screen.getByRole("button", { name: "打开思绪工坊" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开思绪工坊" }));
  expect(open).toHaveBeenCalledWith("/apps/thought-workshop");
  await user.click(screen.getByRole("button", { name: "全部应用" }));
  await user.type(screen.getByRole("textbox", { name: "搜索应用" }), "视频");
  await user.click(screen.getByRole("button", { name: "打开视觉创作工坊" }));
  expect(open).toHaveBeenCalledWith("/apps/visual-workshop");
  expect(localStorage.getItem("future-props-recent-applications")).toContain(
    "visual-workshop",
  );
  expect(screen.getAllByText("视觉创作工坊")).toHaveLength(2);
});

test("home gives model services and programming agents independent management entries", async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(<HomePage onNavigate={navigate} />);
  const models = screen.getByRole("region", { name: "模型服务" });
  const agents = screen.getByRole("region", { name: "编程智能体" });
  await user.click(within(models).getByRole("button", { name: "管理模型" }));
  expect(navigate).toHaveBeenLastCalledWith("/model-service");
  await user.click(within(agents).getByRole("button", { name: "管理智能体" }));
  expect(navigate).toHaveBeenLastCalledWith("/code-agents");
  expect(within(models).getAllByRole("button")).toHaveLength(1);
  expect(within(agents).getAllByRole("button")).toHaveLength(1);
  expect(within(models).getAllByRole("listitem")).toHaveLength(3);
  expect(within(agents).getAllByRole("listitem")).toHaveLength(5);
  expect(within(agents).getByText("Codex")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "开始测试" })).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "管理集成" }),
  ).not.toBeInTheDocument();
  expect(
    within(agents).getByText("支持的 CLI · 连接与执行配置"),
  ).toBeInTheDocument();
});
