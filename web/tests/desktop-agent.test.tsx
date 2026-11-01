import {
  act,
  render as baseRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { DesktopAgentHost } from "@app/DesktopAgentHost";
import { DesktopAgentSettings } from "@features/accounts/DesktopAgentSettings";
import type { OpenDetail } from "@features/integrations/interaction";

const render = (node: ReactNode) =>
  baseRender(
    <QueryClientProvider client={new QueryClient()}>
      {node}
    </QueryClientProvider>,
  );

const state = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  me: { user: { id: "u1" }, workspace: { id: "w1", name: "本地作品" } },
}));
vi.mock("@platform/api/client", () => ({
  api: { GET: state.get, POST: state.post },
  unwrap: async (value: unknown) => value,
}));
vi.mock("@app/StudioSession", () => ({
  useStudioSession: () => ({ me: state.me }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.me = { user: { id: "u1" }, workspace: { id: "w1", name: "本地作品" } };
  state.get.mockImplementation(async (path: string) =>
    path.endsWith("inbox") ? { requests: [], change_revision: 0 } : [],
  );
  state.post.mockResolvedValue({});
  window.futurePropsDesktop = {
    version: 1,
    status: vi.fn(),
    retry: vi.fn(),
    openLogs: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
    openNewWindow: vi.fn(),
    onQuitRequested: vi.fn(),
    agentStatus: vi.fn().mockResolvedValue({ enabled: true, connected: true }),
    enableAgent: vi.fn().mockResolvedValue({ enabled: true, connected: true }),
    disableAgent: vi
      .fn()
      .mockResolvedValue({ enabled: false, connected: false }),
  };
});
afterEach(() => {
  delete window.futurePropsDesktop;
});

test("Web has no desktop polling or settings", () => {
  delete window.futurePropsDesktop;
  render(
    <>
      <DesktopAgentHost />
      <DesktopAgentSettings />
    </>,
  );
  expect(state.get).not.toHaveBeenCalled();
  expect(screen.queryByText("本地 Agent 接入")).not.toBeInTheDocument();
});

test("pairing discloses write risk and binds the displayed code, never receives a key", async () => {
  state.get.mockImplementation(async (path: string) =>
    path.endsWith("inbox")
      ? { requests: [], change_revision: 0 }
      : [
          {
            id: "pair1",
            name: "My Agent",
            code: "123456",
            scope: "studio:write",
            status: "pending",
          },
        ],
  );
  render(<DesktopAgentHost />);
  expect(await screen.findByText(/核对码/)).toHaveTextContent("123456");
  expect(screen.getByText(/此授权允许修改和删除作品/)).toHaveTextContent(
    "费用",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "核对一致，允许接入" }),
  );
  await waitFor(() =>
    expect(state.post).toHaveBeenCalledWith(
      "/v1/desktop/agent/pairings/{pair_id}/decision",
      {
        params: { path: { pair_id: "pair1" } },
        body: { approve: true, code: "123456", expected_owner_user_id: "u1" },
      },
    ),
  );
});

test("cancelled open requests cannot later execute a deferred navigation", async () => {
  state.get.mockImplementation(async (path: string) =>
    path.endsWith("inbox")
      ? {
          requests: [
            {
              id: "open1",
              kind: "visual",
              resource_id: "project1",
              status: "pending",
            },
          ],
          change_revision: 0,
        }
      : [],
  );
  let navigation: { active: () => boolean; opened: () => void } | undefined;
  const listener = (event: Event) => {
    navigation = (event as CustomEvent).detail;
  };
  window.addEventListener("future-props:agent-open", listener);
  try {
    render(<DesktopAgentHost />);
    await screen.findByRole("button", { name: "取消本次打开" });
    expect(navigation?.active()).toBe(true);
    expect(state.post).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: { status: "opened" } }),
    );
    await userEvent.click(screen.getByRole("button", { name: "取消本次打开" }));
    expect(navigation?.active()).toBe(false);
    navigation?.opened();
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        "/v1/desktop/ui/requests/{request_id}/ack",
        {
          params: { path: { request_id: "open1" } },
          body: { status: "cancelled" },
        },
      ),
    );
  } finally {
    window.removeEventListener("future-props:agent-open", listener);
  }
});

test("local access can be disabled without revoking existing business keys", async () => {
  render(<DesktopAgentSettings />);
  await userEvent.click(
    await screen.findByRole("button", { name: "关闭本地接入" }),
  );
  await screen.findByRole("button", { name: "开启本地接入" });
  expect(window.futurePropsDesktop?.disableAgent).toHaveBeenCalledOnce();
  expect(state.post).not.toHaveBeenCalled();
});

test("integration open acknowledges only after the destination finishes loading", async () => {
  state.get.mockImplementation(async (path: string) =>
    path.endsWith("inbox")
      ? {
          requests: [
            {
              id: "skill-open",
              kind: "skill",
              view: "versions",
              resource_id: "s1",
            },
          ],
          change_revision: 0,
        }
      : [],
  );
  let destination: OpenDetail | undefined;
  const navigate = (event: Event) => (event as CustomEvent).detail.opened();
  const locate = (event: Event) => {
    destination = (event as CustomEvent<OpenDetail>).detail;
  };
  window.addEventListener("future-props:agent-open", navigate);
  window.addEventListener("future-props:integration-open", locate);
  try {
    render(<DesktopAgentHost />);
    await waitFor(() => expect(destination?.request.view).toBe("versions"));
    expect(state.post).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: { status: "opened" } }),
    );
    await act(async () => destination?.complete(true));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        "/v1/desktop/ui/requests/{request_id}/ack",
        {
          params: { path: { request_id: "skill-open" } },
          body: { status: "opened" },
        },
      ),
    );
    expect(destination?.active()).toBe(false);
  } finally {
    window.removeEventListener("future-props:agent-open", navigate);
    window.removeEventListener("future-props:integration-open", locate);
  }
});

test("switching workspace invalidates pending integration navigation", async () => {
  state.get.mockImplementation(async (path: string) =>
    path.endsWith("inbox")
      ? {
          requests: [{ id: "skill-open", kind: "skill", view: "list" }],
          change_revision: 0,
        }
      : [],
  );
  let navigation: { active: () => boolean } | undefined;
  const listener = (event: Event) => {
    navigation = (event as CustomEvent).detail;
  };
  window.addEventListener("future-props:agent-open", listener);
  try {
    const view = render(<DesktopAgentHost />);
    await waitFor(() => expect(navigation?.active()).toBe(true));
    const previous = navigation;
    state.me = { ...state.me, workspace: { id: "w2", name: "第二工作区" } };
    await act(async () => {
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <DesktopAgentHost />
        </QueryClientProvider>,
      );
    });
    expect(previous?.active()).toBe(false);
  } finally {
    window.removeEventListener("future-props:agent-open", listener);
  }
});
