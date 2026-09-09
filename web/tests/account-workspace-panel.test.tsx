import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountWorkspacePanel } from "@features/accounts/AccountWorkspacePanel";
import type { AccountSessionContext } from "@features/accounts/api";

const accountApi = vi.hoisted(() => ({
  createApiKey: vi.fn(),
  listWorkspaces: vi.fn(),
  listMyInvitations: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  listWorkspaceInvitations: vi.fn(),
  updateWorkspace: vi.fn(),
  listAccountSessions: vi.fn(),
  listApiKeys: vi.fn(),
  listPlatformAccounts: vi.fn(),
  listSecurityEvents: vi.fn(),
}));

vi.mock("@features/accounts/api", async () => {
  const actual = await vi.importActual<typeof import("@features/accounts/api")>(
    "@features/accounts/api",
  );
  return { ...actual, ...accountApi };
});

const me = {
  policy_revision: 0,
  user: {
    platform_role: "super_admin" as const,
    id: "user-1",
    username: "admin",
    display_name: "管理员",
    email: null,
    avatar_url: null,
    is_platform_admin: true,
    revision: 0,
  },
  workspace: {
    id: "default",
    name: "未来道具研究所",
    visibility: "private",
    revision: 0,
    access_kind: "owner",
    role: "owner",
    permission_keys: [
      "content.read",
      "content.write",
      "models.use",
      "configuration.manage",
      "logs.read",
      "workspace.manage",
      "members.manage",
      "members.assign_admin",
      "audit.read",
    ] as string[],
  },
  must_change_password: false,
  session_expires_at: "2026-08-30T23:59:59Z",
} as const;

const generatedKey = {
  id: "key-1",
  name: "Codex 临时写入",
  key_prefix: "fpm_example",
  scopes: ["studio:read", "studio:write"],
  expires_at: "2026-11-28T00:00:00Z",
  last_used_at: null,
  revoked_at: null,
  revision: 0,
  created_at: "2026-08-30T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  accountApi.listWorkspaces.mockResolvedValue({
    items: [
      {
        ...me.workspace,
        owner_display_name: "管理员",
        owner_username: "admin",
      },
      {
        ...me.workspace,
        id: "another",
        name: "协作空间",
        owner_display_name: "同事",
        owner_username: "team",
      },
    ],
    total: 2,
  });
  accountApi.listMyInvitations.mockResolvedValue({ items: [], total: 0 });
  accountApi.listWorkspaceMembers.mockResolvedValue({ items: [], total: 0 });
  accountApi.listWorkspaceInvitations.mockResolvedValue({
    items: [],
    total: 0,
  });
  accountApi.updateWorkspace.mockResolvedValue(me.workspace);
  accountApi.listAccountSessions.mockResolvedValue({ items: [], total: 0 });
  accountApi.listApiKeys.mockResolvedValue([]);
  accountApi.listPlatformAccounts.mockResolvedValue({ items: [], total: 0 });
  accountApi.listSecurityEvents.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 50,
  });
  accountApi.createApiKey.mockResolvedValue({
    api_key: generatedKey,
    secret: "fpm_copy-this-once",
  });
});

test("creates and copies a Management API Key without a password unlock form", async () => {
  const user = userEvent.setup();
  const session: AccountSessionContext = {
    me,
    refresh: vi.fn(),
    logout: vi.fn(),
    switchWorkspace: vi.fn(),
  };
  render(<AccountWorkspacePanel session={session} />);

  await user.click(screen.getByRole("button", { name: "账号菜单" }));
  await user.click(screen.getByRole("menuitem", { name: "账号设置" }));
  await user.click(screen.getByRole("button", { name: "API 密钥" }));

  expect(
    screen.queryByRole("heading", { name: "敏感操作解锁" }),
  ).not.toBeInTheDocument();

  await user.type(screen.getByLabelText("密钥名称"), "Codex 临时写入");
  await user.click(screen.getByLabelText("允许写入当前工作区"));
  await user.click(screen.getByRole("button", { name: "创建 90 天密钥" }));

  expect(await screen.findByText("fpm_copy-this-once")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "复制密钥" }));

  await waitFor(async () => {
    expect(await navigator.clipboard.readText()).toBe("fpm_copy-this-once");
  });
  expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  expect(accountApi.createApiKey).toHaveBeenCalledWith("Codex 临时写入", [
    "studio:read",
    "studio:write",
  ]);
  await user.click(screen.getByRole("button", { name: "安全记录" }));
  await user.click(screen.getByRole("button", { name: "API 密钥" }));
  expect(screen.queryByText("fpm_copy-this-once")).not.toBeInTheDocument();
});

test("账号菜单键盘导航及关闭后恢复焦点", async () => {
  const user = userEvent.setup();
  render(
    <AccountWorkspacePanel
      session={{
        me,
        refresh: vi.fn(),
        logout: vi.fn(),
        switchWorkspace: vi.fn(),
      }}
    />,
  );
  const trigger = screen.getByRole("button", { name: "账号菜单" });
  await user.click(trigger);
  expect(screen.getByRole("menuitem", { name: "账号设置" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "管理中台" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "退出登录" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("空间草稿不会自动保存，放弃之前不执行切换", async () => {
  const user = userEvent.setup();
  const switchWorkspace = vi.fn().mockResolvedValue(undefined);
  render(
    <AccountWorkspacePanel
      session={{ me, refresh: vi.fn(), logout: vi.fn(), switchWorkspace }}
    />,
  );
  await user.click(screen.getByRole("button", { name: /切换工作区/ }));
  await screen.findByRole("button", { name: /协作空间/ });
  await user.type(screen.getByLabelText("空间名称"), "草稿");
  await user.click(screen.getByRole("button", { name: /协作空间/ }));
  expect(switchWorkspace).not.toHaveBeenCalled();
  expect(accountApi.updateWorkspace).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText("空间名称")).toHaveValue("未来道具研究所草稿");
  await user.click(screen.getByRole("button", { name: /协作空间/ }));
  await user.click(screen.getByRole("button", { name: "放弃更改" }));
  await waitFor(() =>
    expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith("another"),
  );
});

test("空间设置统一提交且携带版本，冲突后保留输入", async () => {
  const { ApiError } = await import("@platform/api/client");
  accountApi.updateWorkspace.mockRejectedValue(
    new ApiError("版本冲突，请核对", { status: 409 }, 409),
  );
  const user = userEvent.setup();
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <AccountWorkspacePanel
      session={{ me, refresh, logout: vi.fn(), switchWorkspace: vi.fn() }}
    />,
  );
  await user.click(screen.getByRole("button", { name: /切换工作区/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /协作空间/ })).toBeEnabled(),
  );
  await user.clear(screen.getByLabelText("空间名称"));
  await user.type(screen.getByLabelText("空间名称"), "新空间名");
  await user.click(screen.getByRole("button", { name: "保存更改" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("版本冲突");
  expect(screen.getByLabelText("空间名称")).toHaveValue("新空间名");
  expect(accountApi.updateWorkspace).toHaveBeenCalledExactlyOnceWith(
    "新空间名",
    "private",
    0,
  );
});

test("只读成员可看角色说明但没有空间治理入口", async () => {
  const user = userEvent.setup();
  render(
    <AccountWorkspacePanel
      session={{
        me: {
          ...me,
          user: {
            ...me.user,
            platform_role: "member" as const,
            is_platform_admin: false,
          },
          workspace: {
            ...me.workspace,
            role: "viewer",
            permission_keys: ["content.read"],
          },
        },
        refresh: vi.fn(),
        logout: vi.fn(),
        switchWorkspace: vi.fn(),
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: /切换工作区/ }));
  const dialog = screen.getByRole("dialog", { name: "工作区" });
  expect(
    within(dialog).queryByRole("button", { name: /成员与邀请/ }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: "保存更改" }),
  ).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: /角色与权限/ }));
  expect(
    within(dialog).getByRole("columnheader", { name: "只读成员" }),
  ).toBeInTheDocument();
});

test("收到的邀请与当前空间发出的邀请分开呈现", async () => {
  accountApi.listMyInvitations.mockResolvedValue({
    items: [
      {
        id: "received",
        workspace_name: "其他团队",
        status: "pending",
        role: "viewer",
        expires_at: "2026-12-01T00:00:00Z",
      },
    ],
  });
  accountApi.listWorkspaceInvitations.mockResolvedValue({
    items: [
      {
        id: "sent",
        invitee_username: "new-colleague",
        status: "pending",
        role: "member",
        expires_at: "2026-12-01T00:00:00Z",
      },
    ],
  });
  const user = userEvent.setup();
  render(
    <AccountWorkspacePanel
      session={{
        me,
        refresh: vi.fn(),
        logout: vi.fn(),
        switchWorkspace: vi.fn(),
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: /切换工作区/ }));
  await user.click(screen.getByRole("button", { name: /成员与邀请/ }));
  expect(await screen.findByText("@new-colleague")).toBeInTheDocument();
  expect(screen.queryByText("其他团队")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /我收到的邀请/ }));
  expect(await screen.findByText("其他团队")).toBeInTheDocument();
  expect(screen.queryByText("@new-colleague")).not.toBeInTheDocument();
});
