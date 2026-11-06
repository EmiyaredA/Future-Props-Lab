import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ManagedAccountsPage } from "@features/accounts/ManagedAccountsPage";
import { ManagementConsole } from "@features/accounts/ManagementConsole";
import type { AccountSessionContext } from "@features/accounts/api";

const management = vi.hoisted(() => ({
  fetchManagedAccounts: vi.fn(),
  createManagedAccount: vi.fn(),
  patchManagedAccount: vi.fn(),
}));
vi.mock("@features/accounts/managementApi", async () => ({
  ...(await vi.importActual("@features/accounts/managementApi")),
  ...management,
}));
const account = {
  platform_role: "user" as const,
  id: "target",
  username: "collaborator",
  display_name: "协作账号",
  email: null,
  is_platform_admin: false,
  status: "active",
  must_change_password: false,
  revision: 8,
  last_login_at: null,
  created_at: "2026-09-01T00:00:00Z",
};
function setup() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <ManagedAccountsPage userId="self" />
    </QueryClientProvider>,
  );
  return cache;
}
beforeEach(() => {
  vi.clearAllMocks();
  management.fetchManagedAccounts.mockResolvedValue({
    items: [account],
    total: 26,
    page: 1,
    page_size: 25,
  });
});

test("服务端分页与邮箱搜索都进入账号查询参数", async () => {
  const user = userEvent.setup();
  setup();
  await screen.findByText("协作账号");
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() =>
    expect(management.fetchManagedAccounts).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    ),
  );
  await user.type(screen.getByLabelText("搜索账号"), "team@example.invalid");
  await waitFor(() =>
    expect(management.fetchManagedAccounts).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "team@example.invalid", page: 1 }),
    ),
  );
});

test("一次性密码关闭后从界面与请求缓存中清除，并恢复键盘焦点", async () => {
  management.createManagedAccount.mockResolvedValue({
    account,
    temporary_password: "One-time-Password-2026!",
  });
  const user = userEvent.setup();
  const cache = setup();
  await screen.findByText("协作账号");
  await user.click(screen.getByRole("button", { name: "创建账号" }));
  const dialog = screen.getByRole("dialog", { name: "创建账号" });
  await user.type(
    within(dialog).getByLabelText("用户名", { exact: true }),
    "new-account",
  );
  await user.click(within(dialog).getByRole("button", { name: "创建账号" }));
  await screen.findByRole("dialog", { name: "临时密码只显示一次" });
  expect(screen.getByText("One-time-Password-2026!")).toBeInTheDocument();
  await user.click(
    within(
      screen.getByRole("dialog", { name: "临时密码只显示一次" }),
    ).getByRole("button", { name: "关闭" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText("One-time-Password-2026!"),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(
      JSON.stringify(
        cache
          .getMutationCache()
          .getAll()
          .map((m) => m.state.data),
      ),
    ).not.toContain("One-time-Password"),
  );
  expect(screen.getByRole("button", { name: "创建账号" })).toHaveFocus();
});

test("角色变更携带读取版本，冲突后刷新且不自动重试", async () => {
  management.patchManagedAccount.mockRejectedValue(
    new Error("内容已被其他操作更新"),
  );
  const user = userEvent.setup();
  setup();
  await screen.findByText("协作账号");
  await user.click(screen.getByRole("button", { name: "管理 collaborator" }));
  await user.click(screen.getByRole("menuitem", { name: "设为管理员" }));
  const confirm = screen.getByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "确认" }));
  await screen.findByRole("alert");
  expect(management.patchManagedAccount).toHaveBeenCalledExactlyOnceWith(
    "target",
    {
      platform_role: "admin" as const,
      expected_revision: 8,
    },
  );
  await waitFor(() =>
    expect(
      management.fetchManagedAccounts.mock.calls.filter(
        ([filters]) => filters.page_size === 25,
      ),
    ).toHaveLength(2),
  );
});

test("普通用户直接进入管理地址不挂载治理查询", () => {
  const session = {
    me: {
      user: {
        platform_role: "user" as const,
        is_platform_admin: false,
      },
    },
  } as AccountSessionContext;
  render(
    <ManagementConsole
      page="management-accounts"
      session={session}
      navigate={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "需要平台管理员权限" }),
  ).toBeInTheDocument();
  expect(management.fetchManagedAccounts).not.toHaveBeenCalled();
});

test("统计读取全平台计数，列表搜索不改变统计范围", async () => {
  management.fetchManagedAccounts.mockImplementation(async (filters) => ({
    items: filters.page_size === 1 ? [] : [account],
    total:
      filters.page_size !== 1
        ? 1
        : filters.status === "active"
          ? 17
          : filters.status === "disabled"
            ? 3
            : filters.is_platform_admin
              ? 2
              : 20,
  }));
  const user = userEvent.setup();
  setup();
  await screen.findByText("20");
  expect(screen.getByText("17")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
  await user.type(screen.getByLabelText("搜索账号"), "someone");
  await waitFor(() =>
    expect(management.fetchManagedAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ q: "someone", page_size: 25 }),
    ),
  );
  expect(
    management.fetchManagedAccounts.mock.calls
      .filter(([filters]) => filters.page_size === 1)
      .every(([filters]) => filters.q === ""),
  ).toBe(true);
});
