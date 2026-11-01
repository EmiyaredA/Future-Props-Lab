import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";
import { AgentWorkbenchPage } from "@features/agent-workbench/AgentWorkbenchPage";
import {
  workbenchEntries,
  workbenchSessions,
  workbenchSource,
} from "../e2e/fixtures/agent-workbench";
import * as api from "@features/agent-workbench/api";

vi.mock("@features/agent-workbench/api", async (original) => ({
  ...(await original<typeof api>()),
  getSources: vi.fn(),
  getSessions: vi.fn(),
  getSession: vi.fn(),
  getHistory: vi.fn(),
  getCandidates: vi.fn(),
  bindSource: vi.fn(),
  changeSource: vi.fn(),
  removeSource: vi.fn(),
  setFavorite: vi.fn(),
}));

class FakeEventSource {
  static current: FakeEventSource;
  listeners = new Map<string, () => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor() {
    FakeEventSource.current = this;
  }
  addEventListener(name: string, callback: () => void) {
    this.listeners.set(name, callback);
  }
  close() {
    this.closed = true;
  }
  emit() {
    this.listeners.get("change")?.();
  }
}

function mount(sourcesPage = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const open = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AccountAccessProvider
        userId="fixture"
        permissions={["content.read", "content.write"]}
      >
        <AgentWorkbenchPage
          scopeKey="fixture"
          sessionId="fixture-0"
          sourcesPage={sourcesPage}
          onOpenSession={open}
          onSources={vi.fn()}
          onBack={vi.fn()}
        />
      </AccountAccessProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient, open };
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.mocked(api.getSources).mockResolvedValue([workbenchSource]);
  vi.mocked(api.getSessions).mockImplementation(async (filters) => ({
    items: workbenchSessions.filter(
      (item) =>
        (!filters.agent_id || item.agent_id === filters.agent_id) &&
        (!filters.origin || item.origins.includes(filters.origin)) &&
        (!filters.q || item.title.includes(filters.q)),
    ),
    next_cursor: null,
    change_cursor: 1,
  }));
  vi.mocked(api.getSession).mockResolvedValue(workbenchSessions[0]);
  vi.mocked(api.getHistory).mockResolvedValue({
    items: workbenchEntries(),
    next_cursor: null,
    change_cursor: 1,
    branches: [],
    selected_branch: null,
  });
  vi.mocked(api.getCandidates).mockResolvedValue([
    {
      agent_id: "codex",
      root: "/fixture/codex",
      label: "Codex APP / CLI",
      exists: true,
    },
  ]);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Agent 工作台", () => {
  it("renders native history, filters APP/CLI and never enables send", async () => {
    const { open, unmount } = mount();
    expect(
      await screen.findByRole("heading", { name: "修复文件上传后的预览状态" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/建议在上传成功后立即创建预览 URL/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "发送（待接入）" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Claude", exact: true }),
    );
    await waitFor(() =>
      expect(api.getSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({ agent_id: "claude-code" }),
        undefined,
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /添加数据导出功能/ }),
    );
    expect(open).toHaveBeenCalledWith("fixture-3");
    unmount();
    expect(FakeEventSource.current.closed).toBe(true);
  });

  it("updates after SSE, and pause only stops the selected history refresh", async () => {
    const { unmount } = mount();
    await screen.findByText(/建议在上传成功后立即创建预览 URL/);
    const initial = vi.mocked(api.getHistory).mock.calls.length;
    await act(async () => {
      FakeEventSource.current.emit();
    });
    await waitFor(() =>
      expect(api.getHistory).toHaveBeenCalledTimes(initial + 1),
    );
    fireEvent.click(screen.getByRole("button", { name: /暂停跟随/ }));
    const paused = vi.mocked(api.getHistory).mock.calls.length;
    await act(async () => {
      FakeEventSource.current.emit();
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(api.getHistory).toHaveBeenCalledTimes(paused);
    expect(screen.getByText(/已暂停当前视图跟随/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /恢复跟随/ }));
    await waitFor(() =>
      expect(api.getHistory).toHaveBeenCalledTimes(paused + 1),
    );
    unmount();
  });

  it("requires explicit source consent and does not change native agent settings", async () => {
    mount(true);
    await screen.findByRole("button", { name: /Codex APP \/ CLI/ });
    const submit = screen.getByRole("button", { name: "绑定并开始同步" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Codex APP \/ CLI/ }));
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /允许当前账号读取/ }));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(api.bindSource).toHaveBeenCalledWith({
        agent_id: "codex",
        root: "/fixture/codex",
        label: "Codex APP / CLI",
        endpoint: "",
      }),
    );
    const source = screen.getByRole("heading", {
      name: /当前账号的来源/,
    }).parentElement!;
    expect(
      within(source).getByText(workbenchSource.message),
    ).toBeInTheDocument();
  });
});
