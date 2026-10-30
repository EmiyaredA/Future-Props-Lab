import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PermissionPolicyPage } from "@features/accounts/PermissionPolicyPage";
import { RegistrationInvitesPage } from "@features/accounts/RegistrationInvitesPage";
import { WorkspacePermissionsProvider } from "@platform/auth/WorkspacePermissions";
import { ProjectCertification } from "@features/accounts/ProjectCertification";
const api = vi.hoisted(() => ({
  fetchPolicy: vi.fn(),
  fetchQuotas: vi.fn(),
  savePolicy: vi.fn(),
  saveQuotas: vi.fn(),
  fetchInviteCodes: vi.fn(),
  createInviteCode: vi.fn(),
}));
vi.mock("@features/accounts/platformApi", async () => ({
  ...(await vi.importActual("@features/accounts/platformApi")),
  ...api,
}));
const flags = {
  view_cross_workspace_logs: false,
  view_model_diagnostics: false,
  view_realtime_voice_diagnostics: false,
  view_sensitive_tool_results: false,
  view_developer_docs: false,
  mark_workshop_official: false,
};
function mount(content: React.ReactNode) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={cache}>{content}</QueryClientProvider>);
  return cache;
}
beforeEach(() => {
  vi.clearAllMocks();
  api.fetchPolicy.mockResolvedValue({
    revision: 4,
    value: { admin: { ...flags }, member: { ...flags } },
  });
  api.fetchQuotas.mockResolvedValue({
    revision: 0,
    value: {
      member: { total: 2, realtime_voice: 1 },
      admin: { total: 4, realtime_voice: 2 },
      super_admin: { total: 8, realtime_voice: 4 },
      instance: { total: 16, realtime_voice: 8 },
      workspace_total: 8,
      reserved_for_admins: 2,
    },
  });
  api.fetchInviteCodes.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 25,
  });
});

test("固定超级管理员能力和普通用户认证限制不可切换，冲突保留策略草稿", async () => {
  api.savePolicy.mockRejectedValue(new Error("版本冲突，请核对"));
  const user = userEvent.setup();
  mount(<PermissionPolicyPage />);
  const toggle = await screen.findByRole("switch", {
    name: "普通用户 · 开发者文档",
  });
  expect(
    screen.queryByRole("switch", { name: "普通用户 · 官方作品认证" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("switch", { name: /超级管理员/ }),
  ).not.toBeInTheDocument();
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "保存权限策略" }));
  await screen.findByRole("alert");
  expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(api.savePolicy).toHaveBeenCalledExactlyOnceWith({
    expected_revision: 4,
    value: { admin: flags, member: { ...flags, view_developer_docs: true } },
  });
});

test("创建邀请码的秘密不进入查询缓存，关闭窗口后清除并归还焦点", async () => {
  api.createInviteCode.mockResolvedValue({
    invite: { id: "invite" },
    secret: "fpri_ephemeral_only",
  });
  const user = userEvent.setup();
  const cache = mount(<RegistrationInvitesPage />);
  await user.click(screen.getByRole("button", { name: "创建邀请码" }));
  const dialog = screen.getByRole("dialog", { name: "创建邀请码" });
  await user.type(
    within(dialog).getByLabelText("名称", { exact: true }),
    "新成员",
  );
  await user.click(within(dialog).getByRole("button", { name: "创建邀请码" }));
  const secret = await screen.findByRole("dialog", { name: "邀请码已就绪" });
  expect(secret).toHaveTextContent("fpri_ephemeral_only");
  expect(
    JSON.stringify(
      cache
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    ),
  ).not.toContain("fpri_ephemeral_only");
  await user.click(within(secret).getByRole("button", { name: "关闭" }));
  await waitFor(() =>
    expect(screen.queryByText("fpri_ephemeral_only")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "创建邀请码" })).toHaveFocus();
});

test("官方标记同时要求平台能力和空间写权限", () => {
  mount(
    <WorkspacePermissionsProvider
      permissions={["content.read", "projects.certify"]}
    >
      <ProjectCertification
        kind="visual"
        project={{ id: "p", title: "项目", revision: 1, is_official: false }}
        queryKey={[]}
      />
    </WorkspacePermissionsProvider>,
  );
  expect(
    screen.queryByRole("button", { name: "标记官方作品" }),
  ).not.toBeInTheDocument();
});

test("按角色保存账号生成等待上限，并保留配额 CAS", async () => {
  api.saveQuotas.mockImplementation(async (body) => ({
    revision: 1,
    value: body.value,
  }));
  const user = userEvent.setup();
  mount(<PermissionPolicyPage />);
  const group = await screen.findByRole("group", { name: "普通用户" });
  const limit = within(group).getByRole("spinbutton", {
    name: "图片／视频等待上限",
  });
  expect(limit).toHaveValue(20);
  await user.clear(limit);
  await user.type(limit, "5");
  await user.click(screen.getByRole("button", { name: "保存并发配额" }));
  await waitFor(() =>
    expect(api.saveQuotas).toHaveBeenCalledWith(
      expect.objectContaining({
        expected_revision: 0,
        value: expect.objectContaining({
          generation_queue: { member: 5, admin: 20, super_admin: 20 },
        }),
      }),
    ),
  );
});
