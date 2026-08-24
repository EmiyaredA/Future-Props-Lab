import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioAuthGate } from "@app/StudioAuthGate";

const accountApi = vi.hoisted(() => ({
  changePassword: vi.fn(),
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  switchWorkspace: vi.fn(),
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
