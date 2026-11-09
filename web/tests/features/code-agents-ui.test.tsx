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
  model_catalog: "not_checked",
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
  ["runtime_unavailable", "执行器不可用"],
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

test.each([
  [
    "codex",
    "Codex",
    'npm --prefix "<FPL 安装目录>" run codex:login',
    "codex --version",
    "在任意目录运行",
  ],
  [
    "claude-code",
    "Claude Code",
    "claude auth login",
    "claude --version",
    "浏览器授权",
  ],
  [
    "opencode",
    "OpenCode",
    "opencode auth login",
    "opencode --version",
    "选择供应商",
  ],
  ["dsh", "DeepSeek Harness", "dsh web", "dsh --version", "Harness 页面"],
  ["pi", "Pi", "pi", "pi --version", "/login"],
] as const)(
  "shows the %s setup guide and copies its command",
  async (id, name, command, version, instruction) => {
    render(
      <AgentConnectionCard
        agent={{ ...codex, id, name, version: "", status: "not_installed" }}
      />,
    );
    const guide = screen.getByRole("region", { name: `${name} 接入教程` });
    expect(within(guide).getByText(command, { exact: true })).toBeVisible();
    expect(within(guide).getByText(version, { exact: true })).toBeVisible();
    expect(within(guide).getByText(new RegExp(instruction))).toBeVisible();
    expect(
      within(guide).getByRole("link", { name: "官方安装指南" }),
    ).toHaveAttribute("href", expect.stringMatching(/^https:/));
    fireEvent.click(
      within(guide).getByRole("button", { name: `复制 ${name} 登录命令` }),
    );
    await within(guide).findByRole("status");
    expect(writeText).toHaveBeenCalledWith(command);
  },
);

test.each([
  ["not_installed", "确认 CLI 已安装"],
  ["unsupported_version", "确认 CLI 已安装"],
  ["not_authenticated", "为 FPL 单独登录 Codex"],
  ["ready_to_enable", "返回 FPL 验证连接"],
  ["disabled", null],
  ["probe_failed", null],
  ["runtime_unavailable", null],
  ["ready", null],
] as const)(
  "highlights only the confirmed next step for %s",
  (status, heading) => {
    const { container } = render(
      <AgentConnectionCard
        agent={{
          ...codex,
          status,
          version: status === "disabled" ? "" : codex.version,
        }}
      />,
    );
    const step = container.querySelector<HTMLElement>('[aria-current="step"]');
    if (heading) {
      expect(step).not.toBeNull();
      expect(
        within(step!).getByRole("heading", { name: heading }),
      ).toBeVisible();
    } else {
      expect(step).toBeNull();
    }
    if (status === "disabled") {
      expect(screen.getByText("安装状态待本机管理员检测。")).toBeVisible();
      expect(screen.queryByText(/已检测到/)).not.toBeInTheDocument();
    }
    if (status === "ready") {
      expect(screen.getByText(/可在有权限的功能中选择 Codex/)).toBeVisible();
    }
  },
);

test("keeps the command available for manual copy when clipboard access fails", async () => {
  writeText.mockRejectedValueOnce(new Error("clipboard blocked"));
  render(<AgentConnectionCard agent={codex} />);
  fireEvent.click(screen.getByRole("button", { name: "复制 Codex 登录命令" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/请手动复制/);
  expect(
    screen.getByText('npm --prefix "<FPL 安装目录>" run codex:login'),
  ).toBeVisible();
});

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
  expect(writeText).toHaveBeenCalledWith(
    'npm --prefix "<FPL 安装目录>" run codex:login',
  );
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
  const { container } = setup(false);
  expect(screen.getByRole("status", { hidden: true })).toHaveTextContent(
    "正在加载…",
  );
  expect(container.querySelector(".code-agent-console")).toBeNull();
  await screen.findByRole("alert");
  expect(container.querySelector(".code-agent-console")).toBeNull();
  expect(screen.getByRole("button", { name: "重新检测" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("article", { name: "Codex 连接" });
  expect(detectAgents).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重新检测" }));
  await screen.findByText("连接状态已更新");
  expect(detectAgents).toHaveBeenCalledOnce();
});

test("blocks duplicate detection and allows a retry after failure", async () => {
  let rejectDetection!: (error: Error) => void;
  vi.mocked(detectAgents).mockReturnValueOnce(
    new Promise((_, reject) => {
      rejectDetection = reject;
    }),
  );
  setup(false);
  const card = await screen.findByRole("article", { name: "Codex 连接" });
  fireEvent.click(within(card).getByRole("button", { name: "重新检测" }));
  const pending = await within(card).findByRole("button", { name: "检测中…" });
  expect(pending).toBeDisabled();
  fireEvent.click(pending);
  expect(detectAgents).toHaveBeenCalledOnce();
  rejectDetection(new Error("检测失败"));
  expect(await within(card).findByRole("alert")).toBeVisible();
  fireEvent.click(within(card).getByRole("button", { name: "重新检测" }));
  await within(card).findByText("连接状态已更新");
  expect(detectAgents).toHaveBeenCalledTimes(2);
});

test.each([
  [false, true],
  [true, false],
])(
  "gives read-only guidance when management access is missing (%s, %s)",
  async (canManage, can_enable) => {
    vi.mocked(getAgents).mockResolvedValue({
      can_enable,
      items: [{ ...codex, enabled: false, status: "disabled", executable: "" }],
    });
    setup(canManage);
    expect(
      await screen.findByText(/请联系运行 FPL 的 Mac 上的管理员/),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "启用 CLI 连接" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "连接详情" }),
    ).not.toBeInTheDocument();
  },
);

test("each supported tutorial contains its own optional MCP setup", async () => {
  setup(false);
  const codexGuide = await screen.findByRole("region", {
    name: "Codex 接入教程",
  });
  const toggle = within(codexGuide).getByRole("button", {
    name: "展开 MCP 配置",
  });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(
    within(codexGuide).getByText(/在网站账号设置中创建 Management API Key/),
  ).toBeVisible();
  expect(
    within(codexGuide).getByText(/fpl --profile codex connect --url/),
  ).toBeVisible();
  fireEvent.click(
    within(codexGuide).getByRole("button", { name: "复制 Codex MCP 配置" }),
  );
  await within(codexGuide).findByText("Codex 配置已复制");
  expect(writeText.mock.calls[0][0]).toContain('\ncommand = "fpl"\n');

  fireEvent.click(screen.getByRole("button", { name: "Claude Code 已连接" }));
  const claudeGuide = screen.getByRole("region", {
    name: "Claude Code 接入教程",
  });
  fireEvent.click(
    within(claudeGuide).getByRole("button", { name: "展开 MCP 配置" }),
  );
  expect(
    within(claudeGuide).getByText(/fpl --profile claude connect --url/),
  ).toBeVisible();
  fireEvent.click(
    within(claudeGuide).getByRole("button", {
      name: "复制 Claude Code MCP 配置",
    }),
  );
  await within(claudeGuide).findByText("Claude Code 配置已复制");
  expect(
    JSON.parse(writeText.mock.calls[1][0]).mcpServers.future_props_lab.args,
  ).toEqual(["--profile", "claude", "mcp", "serve"]);
});

test("confirms installation before login and enables a local CLI after reauthentication", async () => {
  const pendingLogin = {
    ...claude,
    enabled: false,
    status: "not_authenticated",
  };
  vi.mocked(getAgents).mockResolvedValue({
    can_enable: true,
    items: [pendingLogin],
  });
  vi.mocked(detectAgents).mockResolvedValue({
    can_enable: true,
    items: [{ ...pendingLogin, status: "ready_to_enable" }],
  });
  vi.mocked(reauthenticate).mockResolvedValue(undefined);
  vi.mocked(enableAgent).mockImplementation(async () => {
    vi.mocked(getAgents).mockResolvedValue({
      can_enable: true,
      items: [claude],
    });
  });

  setup();
  const enable = await screen.findByRole("button", { name: "启用 CLI 连接" });
  expect(screen.getByText(/已检测到 Claude Code/)).toBeVisible();
  expect(screen.getByText("尚未通过登录检查。")).toBeVisible();
  expect(enable).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新检测" }));
  await screen.findByText("登录已验证");
  expect(enable).toBeEnabled();
  fireEvent.click(enable);
  const dialog = screen.getByRole("dialog", { name: "启用 Claude Code 连接" });
  const password = within(dialog).getByLabelText("FPL 管理员密码");
  expect(password).toHaveAttribute("type", "password");
  fireEvent.change(password, { target: { value: " fixture password " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "启用连接" }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(reauthenticate).toHaveBeenCalledWith(" fixture password ");
  expect(enableAgent).toHaveBeenCalledWith("claude-code");
  expect(
    screen.queryByRole("button", { name: "启用 CLI 连接" }),
  ).not.toBeInTheDocument();
});
