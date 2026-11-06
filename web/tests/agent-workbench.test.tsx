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
import { useRuntimeAccess } from "@features/accounts/useRuntimeAccess";

vi.mock("@features/accounts/useRuntimeAccess", () => ({
  useRuntimeAccess: vi.fn(() => true),
}));

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
  vi.mocked(useRuntimeAccess).mockReturnValue(true);
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
  it("keeps bound history readable but disables new source binding outside the local browser", async () => {
    vi.mocked(useRuntimeAccess).mockReturnValue(false);
    const { unmount } = mount(true);
    expect(
      await screen.findByText(/请在 Mac 的本机网站入口绑定来源/),
    ).toBeVisible();
    expect(screen.getByRole("group", { name: "绑定来源" })).toBeDisabled();
    expect(api.getCandidates).not.toHaveBeenCalled();
    expect(await screen.findByText(workbenchSource.message)).toBeVisible();
    unmount();
  });

  it("labels native execution errors separately from an assistant reply", async () => {
    vi.mocked(api.getHistory).mockResolvedValue({
      items: [
        {
          ...workbenchEntries()[0],
          role: "system",
          kind: "error",
          text: "MISSING_CREDENTIAL: credential unavailable",
        },
      ],
      next_cursor: null,
      change_cursor: 1,
      branches: [],
      selected_branch: null,
    });
    const { unmount } = mount();
    expect(await screen.findByText("原端错误")).toBeVisible();
    expect(
      screen.getByText("MISSING_CREDENTIAL: credential unavailable"),
    ).toBeVisible();
    expect(screen.getByText(/只读 · 自动同步/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /继续对话/ })).toBeNull();
    unmount();
  });

  it("renders native history, filters APP/CLI and never enables send", async () => {
    const { open, unmount } = mount();
    expect(
      await screen.findByRole("heading", { name: "修复文件上传后的预览状态" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/建议在上传成功后立即创建预览 URL/),
    ).toBeInTheDocument();
    expect(screen.getByText(/只读 · 自动同步/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /继续对话/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Claude" }));
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

  it("keeps Codex calls and their outputs inside one compact reply", async () => {
    const entries = workbenchEntries();
    const call = {
      ...entries[2],
      id: "call",
      native_id: "call:one",
      kind: "tool_call",
      role: "assistant",
      tool_name: "exec",
      text: "rg -n preview",
    };
    const result = {
      ...entries[2],
      id: "result",
      native_id: "result:one",
      text: "matched preview",
      ordinal: 3,
      tool_name: "",
    };
    vi.mocked(api.getSession).mockResolvedValue({
      ...workbenchSessions[0],
      agent_id: "codex",
    });
    vi.mocked(api.getHistory).mockResolvedValue({
      items: [
        entries[0],
        entries[1],
        call,
        result,
        { ...entries[3], ordinal: 4 },
      ],
      next_cursor: null,
      change_cursor: 1,
      branches: [],
      selected_branch: null,
    });
    const { unmount } = mount();
    const transcript = await screen.findByLabelText("会话记录");
    const summary = await within(transcript).findByText("运行了命令");
    expect(
      transcript.querySelectorAll(".aw-message.is-assistant"),
    ).toHaveLength(1);
    expect(within(transcript).getByText("matched preview")).not.toBeVisible();
    fireEvent.click(summary.closest("summary")!);
    const command = within(transcript).getByText("exec");
    fireEvent.click(command.closest("summary")!);
    expect(within(transcript).getByText("Shell")).toBeVisible();
    expect(within(transcript).getByText("matched preview")).toBeVisible();
    expect(within(transcript).getByText(/已经定位到问题/)).toBeVisible();
    unmount();
  });

  it("renders a Codex follow-up with an attachment as its own user message", async () => {
    const [, assistant, call, final] = workbenchEntries();
    const turn_id = "same-turn";
    const followUp = {
      ...assistant,
      role: "user" as const,
      presentation: { turn_id, message_id: "follow-up" },
    };
    vi.mocked(api.getSession).mockResolvedValue({
      ...workbenchSessions[0],
      agent_id: "codex",
    });
    vi.mocked(api.getHistory).mockResolvedValue({
      items: [
        { ...assistant, text: "助手先说明", presentation: { turn_id } },
        {
          ...call,
          kind: "tool_call",
          role: "assistant",
          presentation: { turn_id },
        },
        {
          ...followUp,
          id: "body",
          native_id: "follow-up:0",
          ordinal: 3,
          text: "## 我的标题\n补充正文",
        },
        {
          ...followUp,
          id: "open",
          native_id: "follow-up:1",
          ordinal: 4,
          text: "",
        },
        {
          ...followUp,
          id: "image",
          native_id: "follow-up:2",
          ordinal: 5,
          text: "[附件引用]",
        },
        {
          ...followUp,
          id: "close",
          native_id: "follow-up:3",
          ordinal: 6,
          text: "",
        },
        {
          ...final,
          ordinal: 7,
          text: "助手继续回复",
          presentation: { turn_id },
        },
      ],
      next_cursor: null,
      change_cursor: 1,
      branches: [],
      selected_branch: null,
    });
    mount();
    const transcript = await screen.findByLabelText("会话记录");
    await within(transcript).findByText("补充正文");
    const [first, user, last] = within(transcript).getAllByRole("article");
    expect(first).toHaveClass("is-assistant");
    expect(first).toHaveTextContent("助手先说明");
    expect(first.querySelector("summary")).not.toBeNull();
    expect(user).toHaveClass("is-user");
    expect(
      within(user).getByRole("heading", { name: "我的标题" }),
    ).toBeVisible();
    expect(within(user).getByText("[附件引用]")).toBeVisible();
    expect(user.querySelectorAll(".aw-line")).toHaveLength(2);
    expect(last).toHaveClass("is-assistant");
    expect(last).toHaveTextContent("助手继续回复");
  });

  it("shows structured question receipts and exposes historical file reading", async () => {
    const entries = workbenchEntries();
    vi.mocked(api.getHistory).mockResolvedValue({
      items: [
        entries[0],
        entries[1],
        {
          ...entries[2],
          id: "question",
          native_id: "question",
          kind: "tool_call",
          role: "assistant",
          text: "",
          tool_name: "request_user_input",
          presentation: {
            call_id: "ask",
            details: { kind: "question", questions: ["失败后怎么处理？"] },
          },
        },
        {
          ...entries[2],
          id: "answer",
          native_id: "answer",
          ordinal: 3,
          text: "",
          presentation: {
            call_id: "ask",
            details: { kind: "question", answers: ["保留并暂停"] },
          },
        },
        {
          ...entries[2],
          id: "read",
          native_id: "read",
          ordinal: 4,
          text: "",
          tool_name: "read_file",
          presentation: {
            details: {
              kind: "file",
              file: { path: "src/preview.py", line: 7 },
            },
          },
        },
      ],
      next_cursor: null,
      change_cursor: 1,
      branches: [],
      selected_branch: null,
    });
    const { unmount } = mount();
    const transcript = await screen.findByLabelText("会话记录");
    const activity = await within(transcript).findByText(/2 项操作/);
    fireEvent.click(activity.closest("summary")!);
    fireEvent.click(
      within(transcript)
        .getByText("询问用户", { exact: true })
        .closest("summary")!,
    );
    expect(within(transcript).getByText("失败后怎么处理？")).toBeVisible();
    expect(within(transcript).getByText("保留并暂停")).toBeVisible();
    expect(within(transcript).getByText(/src\/preview.py/)).toBeVisible();
    expect(
      within(transcript).queryByRole("button", { name: "src/preview.py" }),
    ).toBeVisible();
    unmount();
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
