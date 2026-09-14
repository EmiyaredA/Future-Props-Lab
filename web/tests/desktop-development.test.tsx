import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesktopDevelopmentBar } from "../src/app/DesktopDevelopmentBar";
import type { DesktopDevelopmentState } from "@platform/desktop";

let publish: (state: DesktopDevelopmentState) => void;
const state: DesktopDevelopmentState = {
  live: true,
  pending: ["backend"],
  phase: "ready",
  message: "有更新",
  generation: 0,
};
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.futurePropsDesktop = {
    version: 1,
    status: vi.fn(),
    retry: vi.fn(),
    openLogs: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
    agentStatus: vi.fn(),
    enableAgent: vi.fn(),
    disableAgent: vi.fn(),
    onQuitRequested: vi.fn(() => vi.fn()),
    developmentStatus: vi.fn().mockResolvedValue(state),
    applyDevelopmentUpdate: vi.fn(),
    checkDevelopmentUpdate: vi.fn(),
    onDevelopmentState: vi.fn((fn) => {
      publish = fn;
      return vi.fn();
    }),
  };
});
afterEach(() => {
  delete window.futurePropsDesktop;
  client.clear();
});
function show() {
  render(
    <QueryClientProvider client={client}>
      <DesktopDevelopmentBar />
    </QueryClientProvider>,
  );
}

test("backend update does not navigate or discard drafts", async () => {
  const guard = vi.fn((event: Event) => event.preventDefault());
  window.addEventListener("future-props:before-workspace-switch", guard);
  try {
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "应用更新" }),
    );
    expect(
      window.futurePropsDesktop!.applyDevelopmentUpdate,
    ).toHaveBeenCalledOnce();
    expect(guard).not.toHaveBeenCalled();
    expect(screen.getByText("开发模式 · 正式数据")).toBeVisible();
  } finally {
    window.removeEventListener("future-props:before-workspace-switch", guard);
  }
});

test.each(["desktop", "page"])(
  "%s update stays pending when unsaved guard cancels",
  async (kind) => {
    show();
    await screen.findByRole("button", { name: "应用更新" });
    act(() => publish({ ...state, pending: [kind] }));
    const guard = (event: Event) => event.preventDefault();
    window.addEventListener("future-props:before-workspace-switch", guard);
    await userEvent.click(screen.getByRole("button", { name: "应用更新" }));
    expect(
      window.futurePropsDesktop!.applyDevelopmentUpdate,
    ).not.toHaveBeenCalled();
    window.removeEventListener("future-props:before-workspace-switch", guard);
    await userEvent.click(screen.getByRole("button", { name: "应用更新" }));
    expect(
      window.futurePropsDesktop!.applyDevelopmentUpdate,
    ).toHaveBeenCalledOnce();
  },
);

test("compile failure offers recheck, not an unsafe apply", async () => {
  show();
  await screen.findByRole("button", { name: "应用更新" });
  act(() => publish({ ...state, phase: "error" }));
  await userEvent.click(screen.getByRole("button", { name: "重新检查" }));
  expect(
    window.futurePropsDesktop!.checkDevelopmentUpdate,
  ).toHaveBeenCalledOnce();
  expect(
    window.futurePropsDesktop!.applyDevelopmentUpdate,
  ).not.toHaveBeenCalled();
});

test("restored service refreshes queries but defers active editors", async () => {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  show();
  await screen.findByRole("button", { name: "应用更新" });
  act(() => publish({ ...state, generation: 1 }));
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ refetchType: "active" }),
  );
  const guard = (event: Event) => event.preventDefault();
  window.addEventListener("future-props:development-query-refresh", guard);
  try {
    act(() => publish({ ...state, generation: 2 }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ refetchType: "none" }),
    );
    expect(screen.getByText(/编辑内容已保留/)).toBeVisible();
  } finally {
    window.removeEventListener("future-props:development-query-refresh", guard);
  }
});

test("packaged / ordinary web never displays the development toolbar", async () => {
  delete window.futurePropsDesktop;
  show();
  expect(screen.queryByLabelText("开发更新")).not.toBeInTheDocument();
});
