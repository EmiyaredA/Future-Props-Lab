import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ModelInfrastructureHeader } from "@app/layout/ModelInfrastructureHeader";
import { CodeAgentsPage } from "@features/code-agents/CodeAgentsPage";
import { AgentConnectionCard } from "@features/code-agents/AgentConnectionCard";
import { reauthenticate } from "@features/accounts";
import {
  detectAgents,
  enableAgent,
  getAgents,
  type Agent,
} from "@features/code-agents/api";

vi.mock("@features/code-agents/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@features/code-agents/api")>()),
  getAgents: vi.fn(),
  detectAgents: vi.fn(),
  enableAgent: vi.fn(),
}));
vi.mock("@features/accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@features/accounts")>()),
  reauthenticate: vi.fn(),
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
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  const catalog = { can_enable: false, items: [codex, claude] };
  vi.mocked(getAgents).mockResolvedValue(catalog);
  vi.mocked(detectAgents).mockResolvedValue(catalog);
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

test("selecting an agent shows its connection without carrying over disclosure or copy feedback", async () => {
  setup(false);
  const codexCard = await screen.findByRole("article", { name: "Codex 连接" });
  fireEvent.click(within(codexCard).getByRole("button", { name: "连接详情" }));
  fireEvent.click(
    within(codexCard).getByRole("button", { name: "复制 Codex 登录命令" }),
  );
  await screen.findByText("登录命令已复制");

  fireEvent.click(screen.getByRole("button", { name: "Claude Code 已连接" }));
  const claudeCard = screen.getByRole("article", { name: "Claude Code 连接" });
  expect(within(claudeCard).getByText("claude auth login")).toBeVisible();
  expect(
    within(claudeCard).queryByText(claude.executable),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("登录命令已复制")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Codex 连接" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Claude Code 已连接" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(detectAgents).not.toHaveBeenCalled();
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

test("website access offers key-based CLI and multiline MCP configuration", async () => {
  setup(false);
  fireEvent.click(screen.getByRole("button", { name: "展开配置" }));
  expect(screen.getByText(/在网站账号设置中创建 API 密钥/)).toBeVisible();
  expect(screen.getByText(/connect --url http/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "复制 codex MCP 配置" }));
  await screen.findByText("Codex 配置已复制");
  expect(writeText.mock.calls[0][0]).toContain('\ncommand = "fpl"\n');
});

test("enables a local CLI after reauthentication", async () => {
  vi.mocked(getAgents).mockResolvedValue({
    can_enable: true,
    items: [{ ...codex, enabled: false, status: "disabled" }],
  });
  vi.mocked(reauthenticate).mockResolvedValue(undefined);
  vi.mocked(enableAgent).mockImplementation(async () => {
    vi.mocked(getAgents).mockResolvedValue({
      can_enable: true,
      items: [codex],
    });
  });

  setup();
  fireEvent.click(await screen.findByRole("button", { name: "启用 CLI 连接" }));
  const dialog = screen.getByRole("dialog", { name: "启用 Codex 连接" });
  const password = within(dialog).getByLabelText("FPL 管理员密码");
  expect(password).toHaveAttribute("type", "password");
  fireEvent.change(password, { target: { value: " fixture password " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "启用连接" }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(reauthenticate).toHaveBeenCalledWith(" fixture password ");
  expect(enableAgent).toHaveBeenCalledWith("codex");
  expect(
    screen.queryByRole("button", { name: "启用 CLI 连接" }),
  ).not.toBeInTheDocument();
});
