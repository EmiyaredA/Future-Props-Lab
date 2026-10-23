import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ModelInfrastructureHeader } from "@app/layout/ModelInfrastructureHeader";
import { CodeAgentsPage } from "@features/code-agents/CodeAgentsPage";
import { AgentConnectionCard } from "@features/code-agents/AgentConnectionCard";
import { ApiError } from "@platform/api/errors";
import type { DesktopBridge } from "@platform/desktop";
import {
  detectAgents,
  getAgents,
  getGrants,
  putGrants,
  type Agent,
  type Grants,
} from "@features/code-agents/api";

vi.mock("@features/code-agents/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@features/code-agents/api")>()),
  getAgents: vi.fn(),
  getGrants: vi.fn(),
  putGrants: vi.fn(),
  detectAgents: vi.fn(),
}));
vi.mock("@features/accounts", async () => ({
  useDesktopAgentAccess: (
    await import("@features/accounts/useDesktopAgentAccess")
  ).useDesktopAgentAccess,
}));

const codex: Agent = {
  id: "codex",
  name: "Codex",
  executable: "/fixture/bin/codex",
  version: "0.163.0",
  enabled: true,
  available: false,
  status: "ready",
  message: "已连接",
  models: [],
};
const claude: Agent = {
  ...codex,
  id: "claude-code",
  name: "Claude Code",
  executable: "/fixture/bin/claude",
  version: "2.1.259",
};
let state: Grants;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  delete window.futurePropsDesktop;
  state = {
    revision: 3,
    grants: [],
    managed: [],
    legacy: [
      { agent_id: "codex", purpose: "visual_acceptance", user_id: "a" },
      { agent_id: "codex", purpose: "visual_acceptance", user_id: "b" },
    ],
    accounts: [
      { id: "a", name: "管理员" },
      { id: "b", name: "其他成员" },
    ],
  };
  vi.mocked(getAgents).mockResolvedValue({ items: [codex, claude] });
  vi.mocked(detectAgents).mockResolvedValue({ items: [codex, claude] });
  vi.mocked(getGrants).mockImplementation(async () => structuredClone(state));
  vi.mocked(putGrants).mockImplementation(async (body) => {
    state = { ...state, ...body, revision: state.revision + 1 };
    return structuredClone(state);
  });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

function setup(canManage = true, scope = "a:w1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const navigate = vi.fn();
  return {
    client,
    navigate,
    ...render(
      <QueryClientProvider client={client}>
        <CodeAgentsPage
          canManage={canManage}
          scope={scope}
          renderHeader={(actions) => (
            <ModelInfrastructureHeader
              page="code-agents"
              navigate={navigate}
              actions={actions}
            />
          )}
        />
      </QueryClientProvider>,
    ),
  };
}

test("unified header switches by keyboard and keeps route selection separate from writes", async () => {
  const { navigate } = setup(false);
  await screen.findByRole("article", { name: "Codex 连接" });
  expect(screen.getByRole("tab", { name: "编程智能体" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tabpanel")).toHaveAccessibleName("编程智能体");
  fireEvent.keyDown(screen.getByRole("tab", { name: "编程智能体" }), {
    key: "Home",
  });
  expect(navigate).toHaveBeenCalledWith("model-service", true);
  fireEvent.click(screen.getByRole("tab", { name: "编程智能体" }));
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(detectAgents).not.toHaveBeenCalled();
  expect(putGrants).not.toHaveBeenCalled();
  expect(getGrants).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("combobox", { name: "授权账号" }),
  ).not.toBeInTheDocument();
});

test("keyboard navigation restores focus when the next route header mounts", () => {
  const { rerender } = render(
    <ModelInfrastructureHeader
      page="model-service"
      navigate={vi.fn()}
      actions={null}
    />,
  );
  rerender(
    <ModelInfrastructureHeader
      key="next-route"
      page="code-agents"
      navigate={vi.fn()}
      actions={null}
      focusSelected
    />,
  );
  expect(screen.getByRole("tab", { name: "编程智能体" })).toHaveFocus();
});

test.each([
  ["ready", "已连接"],
  ["disabled", "未启用"],
  ["not_installed", "未安装"],
  ["not_authenticated", "未登录"],
  ["unsupported_version", "版本不支持"],
  ["probe_failed", "检测失败"],
  ["not_authorized", "未授权"],
  ["unsupported_platform", "平台不支持"],
  ["future_status", "状态未知"],
])(
  "renders %s from backend status independently of available",
  (status, label) => {
    render(
      <AgentConnectionCard agent={{ ...codex, status, message: "诊断说明" }} />,
    );
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText("诊断说明")).toBeVisible();
  },
);

test("connection details are collapsed and login commands have copy feedback", async () => {
  setup(false);
  const card = await screen.findByRole("article", { name: "Codex 连接" });
  expect(within(card).queryByText(codex.executable)).not.toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button", { name: "连接详情" }));
  expect(within(card).getByText(codex.executable)).toBeVisible();
  fireEvent.click(
    within(card).getByRole("button", { name: "复制 Codex 登录命令" }),
  );
  await screen.findByText("登录命令已复制");
  expect(writeText).toHaveBeenCalledWith("codex login");
});

test("matrix preserves other legacy members and disables account selection during save", async () => {
  let complete: ((value: Grants) => void) | undefined;
  vi.mocked(putGrants).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  setup();
  const toggle = await screen.findByRole("switch", {
    name: "管理员 · Codex · 视觉验收 授权",
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).toHaveAttribute("aria-checked", "true");
  fireEvent.click(toggle);
  await waitFor(() => expect(putGrants).toHaveBeenCalledOnce());
  const body = vi.mocked(putGrants).mock.calls[0][0];
  expect(body.expected_revision).toBe(3);
  expect(body.managed).toContain("codex:visual_acceptance");
  expect(body.grants).toEqual([
    { agent_id: "codex", purpose: "visual_acceptance", user_id: "b" },
  ]);
  expect(screen.getByRole("combobox", { name: "授权账号" })).toBeDisabled();
  expect(
    screen
      .getAllByRole("switch")
      .every((item) => (item as HTMLButtonElement).disabled),
  ).toBe(true);
  expect(screen.getByText("不支持")).toBeVisible();
  await act(async () => {
    complete?.({
      ...state,
      grants: body.grants,
      managed: body.managed,
      revision: 4,
    });
  });
  await screen.findByText("授权已保存");
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
});

test("a revision conflict reloads current grants without retrying the write", async () => {
  vi.mocked(putGrants).mockImplementation(async () => {
    state = {
      ...state,
      revision: 4,
      managed: ["codex:amadeus"],
      grants: [{ agent_id: "codex", purpose: "amadeus", user_id: "a" }],
    };
    throw new ApiError("conflict", { code: "revision_conflict" }, 409);
  });
  setup();
  const toggle = await screen.findByRole("switch", {
    name: "管理员 · Codex · Amadeus 授权",
  });
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  await screen.findByText(
    "授权已被其他操作更新，已载入最新授权。请核对后重新操作。",
  );
  expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(putGrants).toHaveBeenCalledOnce();
  expect(getGrants).toHaveBeenCalledTimes(2);
});

test("empty accounts and request failures offer safe feedback", async () => {
  state.accounts = [];
  setup();
  await screen.findByText("当前空间暂无可授权账号。");
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "授权账号" })).toBeDisabled();
});

test("catalog failures can be retried and detection is explicit", async () => {
  vi.mocked(getAgents).mockRejectedValueOnce(new Error("连接读取失败"));
  setup(false);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("article", { name: "Codex 连接" });
  expect(detectAgents).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重新检测" }));
  await screen.findByText("连接状态已更新");
  expect(detectAgents).toHaveBeenCalledOnce();
});

test("browser access explains desktop requirement and preserves multiline MCP configuration", async () => {
  setup(false);
  expect(screen.getByText("需要桌面版")).toBeVisible();
  expect(screen.queryByText("未开启")).not.toBeInTheDocument();
  expect(screen.queryByText("Codex · TOML")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "展开配置" }));
  expect(screen.getByText(/本地客户端接入需要使用 FPL 桌面版/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "复制 codex MCP 配置" }));
  await screen.findByText("Codex 配置已复制");
  expect(writeText.mock.calls[0][0]).toContain('\ncommand = "fpl"\n');
  fireEvent.click(screen.getByRole("button", { name: "收起配置" }));
  expect(screen.queryByText("Codex · TOML")).not.toBeInTheDocument();
});

test("desktop status is read without enabling access and changes only on explicit action", async () => {
  const agentStatus = vi
    .fn()
    .mockResolvedValue({ enabled: false, connected: false });
  const enableAgent = vi
    .fn()
    .mockResolvedValue({ enabled: true, connected: true });
  const disableAgent = vi
    .fn()
    .mockResolvedValue({ enabled: false, connected: false });
  window.futurePropsDesktop = {
    agentStatus,
    enableAgent,
    disableAgent,
  } as unknown as DesktopBridge;
  setup(false);
  await screen.findByText("未开启");
  expect(enableAgent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "展开配置" }));
  await userEvent.click(screen.getByRole("button", { name: "开启本地接入" }));
  await screen.findByText("已开启");
  expect(enableAgent).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "关闭本地接入" }));
  await screen.findByText("未开启");
  expect(disableAgent).toHaveBeenCalledOnce();
});

test("failed desktop status is never presented as disabled", async () => {
  window.futurePropsDesktop = {
    agentStatus: vi.fn().mockRejectedValue(new Error("bridge failed")),
  } as unknown as DesktopBridge;
  setup(false);
  await screen.findByText("状态读取失败");
  expect(screen.queryByText("未开启")).not.toBeInTheDocument();
});
