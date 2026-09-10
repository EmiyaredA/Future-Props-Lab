import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountWorkspacePanel } from "@features/accounts/AccountWorkspacePanel";
import type { AccountSessionContext } from "@features/accounts/api";

const accountApi = vi.hoisted(() => ({
  inviteWorkspaceMember: vi.fn(),
  patchMemberRole: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  revokeWorkspaceInvitation: vi.fn(),
  respondToInvitation: vi.fn(),
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

vi.mock("@features/accounts/managementApi", async () => ({
  ...(await vi.importActual<typeof import("@features/accounts/managementApi")>(
    "@features/accounts/managementApi",
  )),
  patchMemberRole: accountApi.patchMemberRole,
}));

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
  accountApi.inviteWorkspaceMember.mockResolvedValue(undefined);
  accountApi.patchMemberRole.mockResolvedValue(undefined);
  accountApi.removeWorkspaceMember.mockResolvedValue(undefined);
  accountApi.revokeWorkspaceInvitation.mockResolvedValue(undefined);
  accountApi.respondToInvitation.mockResolvedValue(undefined);
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
  await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
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

test("空间搜索保留分页并在关键词变化后回到第一页", async () => {
  accountApi.listWorkspaces.mockResolvedValue({ items: [], total: 26 });
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
  await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
  expect(await screen.findByText("没有匹配的工作空间。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() =>
    expect(accountApi.listWorkspaces).toHaveBeenLastCalledWith("", 2),
  );
  await user.type(screen.getByLabelText("搜索可访问的空间"), "团队");
  await waitFor(() =>
    expect(accountApi.listWorkspaces).toHaveBeenLastCalledWith("团队", 1),
  );
  expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存更改" })).toBeDisabled();
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
  await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
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
  await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
  const dialog = screen.getByRole("dialog", { name: "工作空间" });
  expect(
    within(dialog).queryByRole("button", { name: "管理成员" }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: "保存更改" }),
  ).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "查看权限" }));
  expect(
    within(dialog).getByRole("heading", { name: "只读成员" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "工作空间管理" })).toBe(dialog);
  expect(
    within(dialog).queryByRole("tab", { name: "成员与邀请" }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("tab", { name: "审计记录" }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).getByText("当前角色").closest("article"),
  ).toHaveTextContent("只读成员");
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
  await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
  await user.click(screen.getByRole("button", { name: "管理成员" }));
  expect(await screen.findByText("@new-colleague")).toBeInTheDocument();
  expect(screen.queryByText("其他团队")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "返回工作空间" }));
  await user.click(screen.getByRole("button", { name: /我收到的邀请/ }));
  expect(await screen.findByText("其他团队")).toBeInTheDocument();
  expect(screen.queryByText("@new-colleague")).not.toBeInTheDocument();
});

test("管理弹窗保留空间草稿，返回恢复入口且只加载当前功能", async () => {
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
  await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
  await screen.findByRole("button", { name: /协作空间/ });
  await user.type(screen.getByLabelText("空间名称"), "草稿");
  const listCalls = accountApi.listWorkspaces.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "查看权限" }));
  const management = screen.getByRole("dialog", { name: "工作空间管理" });
  expect(
    screen.queryByRole("dialog", { name: "工作空间" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(accountApi.listWorkspaces).toHaveBeenCalledTimes(listCalls);
  expect(accountApi.listWorkspaceMembers).not.toHaveBeenCalled();
  await user.click(within(management).getByRole("tab", { name: "成员与邀请" }));
  await waitFor(() =>
    expect(accountApi.listWorkspaceMembers).toHaveBeenCalledTimes(1),
  );
  expect(accountApi.listWorkspaces).toHaveBeenCalledTimes(listCalls);
  await user.click(
    within(management).getByRole("button", { name: "返回工作空间" }),
  );
  expect(screen.getByLabelText("空间名称")).toHaveValue("未来道具研究所草稿");
  expect(screen.getByRole("button", { name: "查看权限" })).toHaveFocus();
  expect(accountApi.updateWorkspace).not.toHaveBeenCalled();
});

const memberFixtures = [
  {
    membership_id: "owner-membership",
    user_id: "user-1",
    username: "owner",
    display_name: "拥有者",
    role: "owner",
    revision: 2,
  },
  {
    membership_id: "admin-membership",
    user_id: "user-2",
    username: "administrator",
    display_name: "空间管理员",
    role: "admin",
    revision: 3,
  },
  {
    membership_id: "member-membership",
    user_id: "user-3",
    username: "colleague",
    display_name: "协作者",
    role: "member",
    revision: 4,
  },
];

test.each(["owner", "admin"] as const)(
  "%s 的成员操作遵守授权边界并携带版本",
  async (role) => {
    accountApi.listWorkspaceMembers.mockResolvedValue({
      items: memberFixtures,
      total: 3,
    });
    const current =
      role === "owner"
        ? me
        : {
            ...me,
            user: {
              ...me.user,
              id: "user-2",
              is_platform_admin: false,
              platform_role: "member" as const,
            },
            workspace: {
              ...me.workspace,
              role,
              access_kind: "member" as const,
              permission_keys: me.workspace.permission_keys.filter(
                (p) => p !== "members.assign_admin",
              ),
            },
          };
    const user = userEvent.setup();
    render(
      <AccountWorkspacePanel
        session={{
          me: current,
          refresh: vi.fn(),
          logout: vi.fn(),
          switchWorkspace: vi.fn(),
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
    await user.click(screen.getByRole("button", { name: "管理成员" }));
    await screen.findByText("@colleague");
    expect(
      screen.queryByRole("button", { name: "移除 owner" }),
    ).not.toBeInTheDocument();
    if (role === "admin")
      expect(
        screen.queryByRole("button", { name: "移除 administrator" }),
      ).not.toBeInTheDocument();
    else
      expect(
        screen.getByRole("button", { name: "移除 administrator" }),
      ).toBeEnabled();
    await user.click(
      screen.getByRole("combobox", { name: "修改 colleague 的工作区角色" }),
    );
    expect(
      screen.queryByRole("option", { name: /工作区管理员/ }) !== null,
    ).toBe(role === "owner");
    await user.click(screen.getByRole("option", { name: /只读成员/ }));
    await waitFor(() =>
      expect(accountApi.patchMemberRole).toHaveBeenCalledExactlyOnceWith(
        "member-membership",
        { role: "viewer", expected_revision: 4 },
      ),
    );
    await user.click(screen.getByRole("button", { name: "移除 colleague" }));
    await waitFor(() =>
      expect(accountApi.removeWorkspaceMember).toHaveBeenCalledExactlyOnceWith(
        memberFixtures[2],
      ),
    );
  },
);

test("成员加载失败可以重试，发送和撤销邀请仍走正式用例", async () => {
  accountApi.listWorkspaceMembers.mockRejectedValueOnce(
    new Error("成员加载失败"),
  );
  const sent = {
    id: "sent",
    invitee_username: "invitee",
    role: "member",
    status: "pending",
    revision: 5,
    expires_at: "2026-12-01T00:00:00Z",
  };
  accountApi.listWorkspaceInvitations.mockResolvedValue({ items: [sent] });
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
  await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
  await user.click(screen.getByRole("button", { name: "管理成员" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("成员加载失败");
  await user.click(screen.getByRole("button", { name: "重新加载" }));
  await screen.findByText("@invitee");
  await user.type(screen.getByLabelText("用户名"), "new-person");
  await user.click(screen.getByRole("button", { name: "发送邀请" }));
  await waitFor(() =>
    expect(accountApi.inviteWorkspaceMember).toHaveBeenCalledExactlyOnceWith(
      "new-person",
      "member",
    ),
  );
  await user.click(
    screen.getByRole("button", { name: "撤销对 invitee 的邀请" }),
  );
  await waitFor(() =>
    expect(
      accountApi.revokeWorkspaceInvitation,
    ).toHaveBeenCalledExactlyOnceWith(sent),
  );
});

test.each(["接受", "拒绝"])("在独立邀请弹窗中%s邀请", async (label) => {
  const invitation = {
    id: "received",
    workspace_name: "受邀空间",
    status: "pending",
    role: "viewer",
    revision: 6,
    expires_at: "2026-12-01T00:00:00Z",
  };
  accountApi.listMyInvitations.mockResolvedValue({ items: [invitation] });
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
  await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
  await user.click(screen.getByRole("button", { name: /我收到的邀请/ }));
  const received = screen.getByRole("dialog", { name: "我收到的邀请" });
  await within(received).findByText("受邀空间");
  accountApi.listMyInvitations.mockResolvedValue({ items: [] });
  await user.click(within(received).getByRole("button", { name: label }));
  await waitFor(() =>
    expect(accountApi.respondToInvitation).toHaveBeenCalledExactlyOnceWith(
      invitation,
      label === "接受" ? "accept" : "decline",
    ),
  );
  expect(await within(received).findByText("没有待处理邀请")).toBeVisible();
});

test("离开成员标签后，旧请求的失败不会污染角色弹窗", async () => {
  let fail!: (error: Error) => void;
  accountApi.listWorkspaceMembers.mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
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
  await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
  await user.click(screen.getByRole("button", { name: "管理成员" }));
  await user.click(screen.getByRole("tab", { name: "角色与权限" }));
  fail(new Error("过期的成员请求"));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("heading", { name: "只读成员" })).toBeVisible();
});
