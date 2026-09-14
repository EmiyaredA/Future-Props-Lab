import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesktopSetupGate } from "@features/accounts/DesktopSetupGate";

const calls = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  login: vi.fn(),
}));
vi.mock("@platform/api/client", () => ({
  api: { GET: calls.get, POST: calls.post },
  unwrap: async (result: unknown) => result,
}));
vi.mock("@features/accounts/api", () => ({ login: calls.login }));

beforeEach(() => {
  vi.clearAllMocks();
  calls.get.mockResolvedValue({ setup_required: true });
  calls.post.mockResolvedValue({ setup_required: false });
  calls.login.mockResolvedValue({});
  window.futurePropsDesktop = {
    version: 1,
    agentStatus: vi
      .fn()
      .mockResolvedValue({ enabled: false, connected: false }),
    enableAgent: vi.fn(),
    disableAgent: vi.fn(),
    status: vi.fn(),
    retry: vi.fn(),
    openLogs: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
    onQuitRequested: vi.fn(() => vi.fn()),
  };
});
afterEach(() => {
  delete window.futurePropsDesktop;
});

test("ordinary Web skips desktop setup entirely", () => {
  delete window.futurePropsDesktop;
  render(
    <DesktopSetupGate>
      <p>工作区</p>
    </DesktopSetupGate>,
  );
  expect(screen.getByText("工作区")).toBeInTheDocument();
  expect(calls.get).not.toHaveBeenCalled();
});

test("first admin uses existing login and clears the first-run form", async () => {
  const user = userEvent.setup();
  render(
    <DesktopSetupGate>
      <p>工作区</p>
    </DesktopSetupGate>,
  );
  await user.type(await screen.findByLabelText("账号"), "local-admin");
  expect(screen.getByRole("button", { name: "创建管理员并进入" })).toHaveClass(
    "desktop-setup-submit",
  );
  await user.type(screen.getByLabelText("显示名称"), "本机管理员");
  await user.type(
    screen.getByLabelText("密码", { exact: true }),
    "Local-test-29471!",
  );
  await user.type(screen.getByLabelText("确认密码"), "Local-test-29471!");
  await user.click(screen.getByRole("button", { name: "创建管理员并进入" }));
  await screen.findByText("工作区");
  expect(calls.post).toHaveBeenCalledWith("/v1/desktop/setup", {
    body: {
      username: "local-admin",
      display_name: "本机管理员",
      password: "Local-test-29471!",
    },
  });
  expect(calls.login).toHaveBeenCalledWith("local-admin", "Local-test-29471!");
  expect(
    screen.queryByLabelText("密码", { exact: true }),
  ).not.toBeInTheDocument();
});

test("mismatch does not submit; server failure clears password fields", async () => {
  const user = userEvent.setup();
  calls.post.mockRejectedValue(new Error("已完成初始化"));
  render(
    <DesktopSetupGate>
      <p>工作区</p>
    </DesktopSetupGate>,
  );
  await user.type(await screen.findByLabelText("账号"), "local-admin");
  await user.type(
    screen.getByLabelText("密码", { exact: true }),
    "Local-test-29471!",
  );
  await user.type(screen.getByLabelText("确认密码"), "Other-test-29471!");
  await user.click(screen.getByRole("button", { name: "创建管理员并进入" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "两次输入的密码不一致",
  );
  expect(calls.post).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("确认密码"));
  await user.type(screen.getByLabelText("确认密码"), "Local-test-29471!");
  await user.click(screen.getByRole("button", { name: "创建管理员并进入" }));
  await waitFor(() =>
    expect(screen.getByLabelText("密码", { exact: true })).toHaveValue(""),
  );
  expect(screen.getByLabelText("确认密码")).toHaveValue("");
  expect(calls.login).not.toHaveBeenCalled();
});

test("password visibility controls are independent and reset after submit", async () => {
  const user = userEvent.setup();
  calls.post.mockRejectedValue(new Error("初始化失败"));
  render(
    <DesktopSetupGate>
      <p>工作区</p>
    </DesktopSetupGate>,
  );
  await screen.findByLabelText("账号");
  const password = screen.getByLabelText("密码", { exact: true });
  const confirmation = screen.getByLabelText("确认密码");

  expect(password).toHaveAttribute("type", "password");
  expect(confirmation).toHaveAttribute("type", "password");
  await user.click(screen.getByRole("button", { name: "显示密码" }));
  expect(password).toHaveAttribute("type", "text");
  expect(confirmation).toHaveAttribute("type", "password");
  expect(screen.getByRole("button", { name: "隐藏密码" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await user.type(screen.getByLabelText("账号"), "local-admin");
  await user.type(password, "Local-test-29471!");
  await user.type(confirmation, "Local-test-29471!");
  await user.click(screen.getByRole("button", { name: "显示确认密码" }));
  expect(confirmation).toHaveAttribute("type", "text");
  await user.click(screen.getByRole("button", { name: "创建管理员并进入" }));

  await waitFor(() => expect(password).toHaveAttribute("type", "password"));
  expect(confirmation).toHaveAttribute("type", "password");
  expect(screen.getByRole("button", { name: "显示密码" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(screen.getByRole("button", { name: "显示确认密码" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
