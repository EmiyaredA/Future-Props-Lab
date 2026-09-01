import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountWorkspacePanel } from "@features/accounts/AccountWorkspacePanel";
import type { AccountSessionContext } from "@features/accounts/api";

const accountApi = vi.hoisted(() => ({
  createApiKey: vi.fn(),
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
  user: {
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

  await user.click(screen.getByRole("button", { name: /管理员 @admin/ }));
  await user.click(screen.getByRole("tab", { name: "安全与密钥" }));

  expect(
    screen.queryByRole("heading", { name: "敏感操作解锁" }),
  ).not.toBeInTheDocument();

  await user.type(screen.getByLabelText("密钥名称"), "Codex 临时写入");
  await user.click(screen.getByLabelText("允许写入当前 Workspace"));
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
});
