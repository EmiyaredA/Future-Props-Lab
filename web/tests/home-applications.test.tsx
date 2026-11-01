import { act, cleanup, render, screen } from "@testing-library/react";
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

test("home keeps the three destinations equal and links model shortcuts", async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(<HomePage onNavigate={navigate} />);
  expect(
    screen.getByRole("heading", { name: "今天想从哪里开始？" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /应用/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /工具导航/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /AI 能力/ })).toBeInTheDocument();
  expect(screen.queryByText("视觉创作工坊")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /浏览应用/ }));
  expect(navigate).toHaveBeenCalledWith("/apps");
  await user.click(screen.getByRole("button", { name: /模型测试/ }));
  expect(navigate).toHaveBeenCalledWith("/model-test");
});

test("home plays bundled Kurisu and pauses while the page is hidden", () => {
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const { container, unmount } = render(<HomePage onNavigate={vi.fn()} />);
  const video = container.querySelector("video")!;
  expect(video).toHaveAttribute("src", "/brand/home/kurisu-idle.webm");
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
    "/brand/home/kurisu-idle.png",
  );
});

test("home uses a static image under reduced motion and follows preference changes", () => {
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
  act(() => listener());
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
    ["Agent 工作台", "agent-workbench"],
    ["思绪工坊", "thought-workshop"],
    ["视觉创作工坊", "visual-workshop"],
    ["Galgame 工坊", "galgame-workshop"],
    ["视频剪辑工坊", "video-editor"],
  ]) {
    expect(
      screen.getByRole("button", { name: `打开${name}` }).querySelector("img"),
    ).toHaveAttribute("src", `/brand/${asset}-mark.png`);
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
