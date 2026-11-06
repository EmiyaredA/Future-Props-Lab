import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountPanel } from "@features/accounts/AccountPanel";
import type { AccountSessionContext } from "@features/accounts/api";

const accountApi = vi.hoisted(() => ({
  inviteWorkspaceMember: vi.fn(),
  patchMemberRole: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  revokeWorkspaceInvitation: vi.fn(),
  respondToInvitation: vi.fn(),
  createApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  renewApiKey: vi.fn(),
  revealApiKeySecret: vi.fn(),
  revokeApiKey: vi.fn(),
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
  user: {
    platform_role: "admin" as const,
    id: "user-1",
    username: "admin",
    display_name: "管理员",
    email: null,
    avatar_url: null,
    is_platform_admin: true,
    revision: 0,
  },
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
  storage_upgrade_required: false,
  must_change_password: false,
  session_expires_at: "2026-08-30T23:59:59Z",
} as const;

const generatedKey = {
  id: "key-1",
  name: "Codex 临时写入",
  key_prefix: "fpm_example",
  secret_available: true,
  scopes: ["studio:read", "studio:write"],
  expires_at: "2026-11-28T00:00:00Z",
  last_used_at: null,
  revoked_at: null,
  revision: 0,
  created_at: "2026-08-30T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
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
  accountApi.deleteApiKey.mockResolvedValue(undefined);
  accountApi.renewApiKey.mockResolvedValue(generatedKey);
  accountApi.revokeApiKey.mockResolvedValue(generatedKey);
});

test("creates and copies a Management API Key without a password unlock form", async () => {
  const user = userEvent.setup();
  const session: AccountSessionContext = {
    me,
    refresh: vi.fn(),
    logout: vi.fn(),
  };
  render(<AccountPanel session={session} />);

  await user.click(screen.getByRole("button", { name: "账号菜单" }));
  await user.click(screen.getByRole("menuitem", { name: "账号设置" }));
  await user.click(screen.getByRole("button", { name: "API 密钥" }));

  expect(
    screen.queryByRole("heading", { name: "敏感操作解锁" }),
  ).not.toBeInTheDocument();

  await user.type(screen.getByLabelText("密钥名称"), "Codex 临时写入");
  await user.click(screen.getByLabelText("允许写入当前账号"));
  await user.click(screen.getByRole("button", { name: "创建密钥" }));

  expect(await screen.findByText("fpm_copy-this-once")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "复制密钥" }));

  await waitFor(async () => {
    expect(await navigator.clipboard.readText()).toBe("fpm_copy-this-once");
  });
  expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument();
  expect(accountApi.createApiKey).toHaveBeenCalledWith(
    "Codex 临时写入",
    ["studio:read", "studio:write"],
    90,
  );
  await user.click(screen.getByRole("button", { name: "安全记录" }));
  await user.click(screen.getByRole("button", { name: "API 密钥" }));
  expect(screen.queryByText("fpm_copy-this-once")).not.toBeInTheDocument();
});

test("ignores a late key response after its dialog closes", async () => {
  const user = userEvent.setup();
  const key = { ...generatedKey, expires_at: "2099-01-01T00:00:00Z" };
  let complete: (value: { secret: string }) => void = () => {};
  accountApi.listApiKeys.mockResolvedValue([key]);
  accountApi.revealApiKeySecret.mockImplementationOnce(
    () => new Promise((resolve) => (complete = resolve)),
  );
  accountApi.revealApiKeySecret.mockResolvedValueOnce({
    secret: "fpm_current-response",
  });
  render(<AccountPanel session={{ me, refresh: vi.fn(), logout: vi.fn() }} />);
  await user.click(screen.getByRole("button", { name: "账号菜单" }));
  await user.click(screen.getByRole("menuitem", { name: "账号设置" }));
  await user.click(screen.getByRole("button", { name: "API 密钥" }));
  const opener = await screen.findByRole("button", { name: "查看并复制" });
  await user.click(opener);
  const signal = accountApi.revealApiKeySecret.mock.calls[0][1] as AbortSignal;
  const dialog = screen.getByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: /^关闭$/ }));
  expect(signal.aborted).toBe(true);
  await user.click(opener);
  expect(await screen.findByDisplayValue("fpm_current-response")).toBeVisible();
  await act(async () => complete({ secret: "fpm_late-response" }));
  expect(
    screen.queryByDisplayValue("fpm_late-response"),
  ).not.toBeInTheDocument();
  expect(screen.getByDisplayValue("fpm_current-response")).toBeVisible();
});

test("filters, renews, revokes and deletes Management API Keys", async () => {
  const user = userEvent.setup();
  const activeKey = { ...generatedKey, name: "自动化部署" };
  const revokedKey = {
    ...generatedKey,
    id: "key-2",
    name: "旧密钥",
    key_prefix: "fpm_revoked",
    revoked_at: "2026-09-01T00:00:00Z",
  };
  accountApi.listApiKeys.mockResolvedValue([activeKey, revokedKey]);
  render(
    <AccountPanel
      session={{
        me,
        refresh: vi.fn(),
        logout: vi.fn(),
      }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "账号菜单" }));
  await user.click(screen.getByRole("menuitem", { name: "账号设置" }));
  await user.click(screen.getByRole("button", { name: "API 密钥" }));
  expect(
    await screen.findByRole("heading", { name: "管理 API 密钥" }),
  ).toBeVisible();

  await user.type(screen.getByLabelText("搜索密钥"), "revoked");
  expect(screen.getByText("旧密钥")).toBeVisible();
  expect(screen.queryByText("自动化部署")).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("搜索密钥"));

  const activeRow = screen.getByRole("row", { name: /自动化部署/ });
  const activeMenu = within(activeRow).getByRole("button", {
    name: "自动化部署更多操作",
  });
  await user.click(activeMenu);
  await user.click(within(activeRow).getByRole("menuitem", { name: "续期" }));
  const renewDialog = screen.getByRole("alertdialog", {
    name: /续期“自动化部署”/,
  });
  await user.click(
    within(renewDialog).getByRole("combobox", { name: "续期时长" }),
  );
  await user.click(screen.getByRole("option", { name: "30 天" }));
  await user.click(
    within(renewDialog).getByRole("button", { name: "确认续期" }),
  );
  await waitFor(() =>
    expect(accountApi.renewApiKey).toHaveBeenCalledWith(activeKey, 30),
  );

  await user.click(activeMenu);
  await user.click(screen.getByRole("menuitem", { name: "撤销密钥" }));
  await user.click(screen.getByRole("button", { name: "确认撤销" }));
  await waitFor(() =>
    expect(accountApi.revokeApiKey).toHaveBeenCalledWith(activeKey),
  );

  const revokedRow = screen.getByRole("row", { name: /旧密钥/ });
  await user.click(
    within(revokedRow).getByRole("button", { name: "旧密钥更多操作" }),
  );
  expect(
    within(revokedRow).queryByRole("menuitem", { name: "续期" }),
  ).not.toBeInTheDocument();
  await user.click(within(revokedRow).getByRole("menuitem", { name: "删除" }));
  expect(screen.getByText(/立即失效并从列表移除/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() =>
    expect(accountApi.deleteApiKey).toHaveBeenCalledWith(revokedKey),
  );
});

test("账号菜单键盘导航及关闭后恢复焦点", async () => {
  const user = userEvent.setup();
  render(
    <AccountPanel
      session={{
        me,
        refresh: vi.fn(),
        logout: vi.fn(),
      }}
    />,
  );
  const trigger = screen.getByRole("button", { name: "账号菜单" });
  await user.click(trigger);
  expect(screen.getByRole("menuitem", { name: "账号设置" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(
    screen.queryByRole("menuitem", { name: "管理中台" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "本地与公网访问" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "退出登录" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "退出登录" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("account drafts guard navigation and discard only after an explicit decision", async () => {
  const user = userEvent.setup(),
    resume = vi.fn();
  const session: AccountSessionContext = {
    me,
    refresh: vi.fn(),
    logout: vi.fn(),
  };
  render(<AccountPanel session={session} />);
  await user.click(screen.getByRole("button", { name: "账号菜单" }));
  await user.click(screen.getByRole("menuitem", { name: "账号设置" }));
  await user.clear(screen.getByLabelText("显示名称"));
  await user.type(screen.getByLabelText("显示名称"), "未保存名称");
  const event = new CustomEvent("future-props:before-navigation", {
    cancelable: true,
    detail: resume,
  });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(resume).not.toHaveBeenCalled();
  const confirm = await screen.findByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "确认" }));
  expect(resume).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "账号设置" }),
    ).not.toBeInTheDocument(),
  );
});
