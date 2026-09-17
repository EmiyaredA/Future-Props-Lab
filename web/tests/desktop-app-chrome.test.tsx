import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudioGlobalHeader } from "@app/layout/StudioGlobalHeader";
import type { DesktopDevelopmentState } from "@platform/desktop";

const state: DesktopDevelopmentState = {
  live: true,
  pending: ["page"],
  phase: "ready",
  message: "有更新待应用",
  generation: 0,
};

beforeEach(() => {
  window.futurePropsDesktop = {
    version: 1,
    status: vi.fn(),
    retry: vi.fn(),
    openLogs: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
    openNewWindow: vi.fn(),
    agentStatus: vi.fn(),
    enableAgent: vi.fn(),
    disableAgent: vi.fn(),
    onQuitRequested: vi.fn(() => vi.fn()),
    developmentStatus: vi.fn().mockResolvedValue(state),
    applyDevelopmentUpdate: vi.fn(),
    checkDevelopmentUpdate: vi.fn(),
    onDevelopmentState: vi.fn(() => vi.fn()),
  };
});

afterEach(() => {
  delete window.futurePropsDesktop;
});

test("ordinary web hides desktop chrome actions", () => {
  delete window.futurePropsDesktop;
  render(<StudioGlobalHeader />);
  expect(
    screen.queryByRole("button", { name: "新建窗口" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "立即应用" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "文档中心" })).toBeInTheDocument();
});

test("desktop header opens a new window from the App chrome", async () => {
  const user = userEvent.setup();
  render(<StudioGlobalHeader />);
  await user.click(screen.getByRole("button", { name: "新建窗口" }));
  expect(window.futurePropsDesktop!.openNewWindow).toHaveBeenCalledOnce();
});

test("idle development state stays collapsed to a badge", async () => {
  window.futurePropsDesktop!.developmentStatus = vi.fn().mockResolvedValue({
    ...state,
    pending: [],
    message: "已是最新",
  });
  render(<StudioGlobalHeader />);
  await waitFor(() =>
    expect(screen.getByText("开发 · 正式数据")).toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: "立即应用" }),
  ).not.toBeInTheDocument();
});

test("development apply expands and uses the shared event path", async () => {
  const user = userEvent.setup();
  const apply = vi.fn();
  window.addEventListener("future-props:development-apply", apply);
  try {
    render(<StudioGlobalHeader />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "立即应用" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("有更新待应用")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "立即应用" }));
    expect(apply).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("future-props:development-apply", apply);
  }
});

test("compile failure offers recheck from the header", async () => {
  const user = userEvent.setup();
  let publish: ((value: DesktopDevelopmentState) => void) | undefined;
  window.futurePropsDesktop!.onDevelopmentState = vi.fn((fn) => {
    publish = fn;
    return vi.fn();
  });
  render(<StudioGlobalHeader />);
  await waitFor(() => expect(publish).toBeDefined());
  act(() => publish!({ ...state, phase: "error", message: "检查失败" }));
  await user.click(screen.getByRole("button", { name: "重新检查" }));
  expect(
    window.futurePropsDesktop!.checkDevelopmentUpdate,
  ).toHaveBeenCalledOnce();
});
