import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioAuthGate } from "@app/StudioAuthGate";

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
  document.cookie = "fpl_csrf=; Max-Age=0; Path=/";
});

test("logs in with a temporary password and forces a password change", async () => {
  document.cookie = "fpl_csrf=test-csrf; Path=/";
  const responses = [
    new Response(JSON.stringify({ detail: { code: "studio_auth_required" } }), {
      status: 401,
    }),
    new Response(JSON.stringify({ ...me, must_change_password: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    new Response(null, { status: 204 }),
    new Response(JSON.stringify(me), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ];
  const fetchMock = vi
    .fn()
    .mockImplementation(() => Promise.resolve(responses.shift()));
  vi.stubGlobal("fetch", fetchMock);
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
  const changeRequest = fetchMock.mock.calls[2];
  expect(changeRequest[0]).toBe("/v1/auth/change-password");
  const headers = (changeRequest[1] as RequestInit).headers as Headers;
  expect(headers.get("X-CSRF-Token")).toBe("test-csrf");
});

test("restores an existing Cookie session before rendering the studio", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(me), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  renderGate();
  await waitFor(() =>
    expect(screen.getByText("账号系统已就绪")).toBeInTheDocument(),
  );
});
