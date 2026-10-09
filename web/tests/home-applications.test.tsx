import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { APPLICATION_DEFINITIONS } from "@app/applicationRegistry";
import { ApplicationCenterPage } from "@features/applications/ApplicationCenterPage";
import { HomePage } from "@features/home/HomePage";

const petApi = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("@features/desktop-pet/api", () => ({
  listProjects: petApi.listProjects,
  getDocument: petApi.getDocument,
}));

vi.mock("@features/desktop-pet/DesktopPetFigure", () => ({
  DesktopPetFigure: ({
    view,
    eventName,
    playbackMode,
    document,
  }: {
    view?: string;
    eventName?: string;
    playbackMode?: string;
    document: { id: string };
  }) => (
    <div
      data-testid="home-kurisu-figure"
      data-view={view}
      data-event={eventName}
      data-mode={playbackMode}
      data-document={document.id}
    />
  ),
}));

beforeEach(() => {
  petApi.listProjects.mockReset();
  petApi.getDocument.mockReset();
  petApi.listProjects.mockResolvedValue({ items: [] });
});

function petProject(
  id: string,
  title: string,
  updatedAt: string,
  sourceTitle = "",
) {
  return {
    id,
    title,
    updatedAt,
    createdAt: updatedAt,
    revision: 1,
    sourceProjectId: null,
    sourceRevision: null,
    sourceTitle,
    sourceType: "coopanion-whale" as const,
  };
}

test("home keeps the three destinations equal and links model shortcuts", async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(<HomePage onNavigate={navigate} />);
  expect(
    screen.getByRole("heading", { name: "今天想从哪里开始？" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /应用/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /工具导航/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /基模型/ })).toBeInTheDocument();
  expect(screen.queryByText("视觉创作工坊")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /浏览应用/ }));
  expect(navigate).toHaveBeenCalledWith("/apps");
  await user.click(screen.getByRole("button", { name: /模型测试/ }));
  expect(navigate).toHaveBeenCalledWith("/model-test");
});

test("home shows the newest desktop-pet Kurisu and keeps the orbit otherwise", async () => {
  petApi.getDocument.mockImplementation(async (id: string) => ({ id }));
  petApi.listProjects.mockResolvedValue({
    items: [
      petProject("old", "牧濑红莉栖", "2024-01-01T00:00:00Z"),
      petProject("new", "实验角色", "2026-10-01T00:00:00Z", "红莉栖立绘"),
      petProject("whale", "鲸鱼", "2026-10-02T00:00:00Z", "whale"),
    ],
  });
  const matched = render(<HomePage onNavigate={vi.fn()} />);
  const figure = await screen.findByTestId("home-kurisu-figure");
  expect(figure).toHaveAttribute("data-view", "center");
  expect(figure).toHaveAttribute("data-event", "idle");
  expect(figure).toHaveAttribute("data-mode", "runtime");
  expect(figure).toHaveAttribute("data-document", "new");
  expect(petApi.getDocument).toHaveBeenCalledTimes(1);
  expect(petApi.getDocument).toHaveBeenCalledWith("new");
  expect(matched.container.querySelector(".home-orbit")).toBeNull();
  expect(matched.container.querySelector(".home-hero-pet")).not.toBeNull();
  matched.unmount();

  const missing = Promise.resolve({
    items: [petProject("whale", "鲸鱼", "2026-10-02T00:00:00Z", "whale")],
  });
  petApi.listProjects.mockReturnValue(missing);
  petApi.getDocument.mockClear();
  const unmatched = render(<HomePage onNavigate={vi.fn()} />);
  await act(async () => {
    await missing;
  });
  expect(screen.queryByTestId("home-kurisu-figure")).not.toBeInTheDocument();
  expect(unmatched.container.querySelector(".home-orbit")).not.toBeNull();
  expect(petApi.getDocument).not.toHaveBeenCalled();
  unmatched.unmount();

  const denied = Promise.reject(new Error("无权限"));
  denied.catch(() => {});
  petApi.listProjects.mockReturnValue(denied);
  const unavailable = render(<HomePage onNavigate={vi.fn()} />);
  await act(async () => {
    await denied.catch(() => {});
  });
  expect(screen.queryByTestId("home-kurisu-figure")).not.toBeInTheDocument();
  expect(unavailable.container.querySelector(".home-orbit")).not.toBeNull();
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
  for (const [name, asset] of [
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
