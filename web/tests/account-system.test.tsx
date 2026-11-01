import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioAuthGate } from "@app/StudioAuthGate";

const accountApi = vi.hoisted(() => ({
  changePassword: vi.fn(),
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@features/accounts/api", async () => {
  const actual = await vi.importActual<typeof import("@features/accounts/api")>(
    "@features/accounts/api",
  );
  return { ...actual, ...accountApi };
});

beforeEach(() => {
  vi.clearAllMocks();
  accountApi.getMe.mockRejectedValue(new Error("未登录"));
  accountApi.changePassword.mockResolvedValue(undefined);
});

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
  ],
  storage_upgrade_required: false,
  must_change_password: false,
  session_expires_at: "2026-08-27T00:00:00Z",
} as const;

function renderGate() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <StudioAuthGate>
        <div>账号系统已就绪</div>
      </StudioAuthGate>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("logs in with a temporary password and forces a password change", async () => {
  accountApi.login.mockResolvedValue({
    ...me,
    must_change_password: true,
  });
  accountApi.getMe
    .mockRejectedValueOnce(new Error("未登录"))
    .mockResolvedValueOnce(me);
  const user = userEvent.setup();
  renderGate();

  await screen.findByRole("heading", { name: "登录 Future Props Lab" });
  await user.type(screen.getByLabelText("用户名"), "admin");
  await user.type(screen.getByLabelText("密码"), "Temporary-2026!");
  await user.click(screen.getByRole("button", { name: "登录" }));

  await screen.findByRole("heading", { name: "设置你的新密码" });
  const passwordInputs = screen.getAllByLabelText(/密码/);
  await user.type(passwordInputs[0], "Temporary-2026!");
  await user.type(passwordInputs[1], "Changed-Password-2026!");
  await user.type(
    screen.getByLabelText("确认新密码"),
    "Changed-Password-2026!",
  );
  await user.click(screen.getByRole("button", { name: "保存并继续" }));

  expect(await screen.findByText("账号系统已就绪")).toBeInTheDocument();
  expect(accountApi.changePassword).toHaveBeenCalledWith(
    "Temporary-2026!",
    "Changed-Password-2026!",
  );
});

test("restores an existing Cookie session before rendering the studio", async () => {
  accountApi.getMe.mockResolvedValue(me);
  renderGate();
  await waitFor(() =>
    expect(screen.getByText("账号系统已就绪")).toBeInTheDocument(),
  );
});

test("returns to the login screen when the shared API client reports session expiry", async () => {
  accountApi.getMe.mockResolvedValue(me);
  renderGate();
  expect(await screen.findByText("账号系统已就绪")).toBeInTheDocument();

  act(() => window.dispatchEvent(new Event("future-props:auth-required")));

  expect(
    await screen.findByRole("heading", { name: "登录 Future Props Lab" }),
  ).toBeInTheDocument();
});

test("permission refresh clears sensitive cached data and remounts the workspace", async () => {
  const { useAccountPermission } = await import("@platform/auth/AccountAccess");
  const cache = new QueryClient();
  function PermissionView() {
    const writable = useAccountPermission("content.write");
    return <button disabled={!writable}>保存内容</button>;
  }
  accountApi.getMe.mockResolvedValue(me);
  render(
    <QueryClientProvider client={cache}>
      <StudioAuthGate>
        <PermissionView />
      </StudioAuthGate>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("button", { name: "保存内容" })).toBeEnabled();
  cache.setQueryData(["private-logs"], { confidential: "old-workspace" });
  accountApi.getMe.mockResolvedValue({
    ...me,
    permission_keys: ["content.read"],
    storage_upgrade_required: false,
  });
  act(() =>
    window.dispatchEvent(new Event("future-props:permissions-changed")),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存内容" })).toBeDisabled(),
  );
  expect(cache.getQueryData(["private-logs"])).toBeUndefined();
});
