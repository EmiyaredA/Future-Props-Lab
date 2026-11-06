import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModelsApplication from "@app/entries/ModelsApplication";

const access = vi.hoisted(() => ({
  permissions: new Set<string>(),
  guard: vi.fn(),
}));
vi.mock("@platform/auth/AccountAccess", () => ({
  useAccountPermission: (permission: string) =>
    access.permissions.has(permission),
}));
vi.mock("@app/StudioSession", () => ({
  useStudioSession: () => ({
    me: { user: { id: "owner-a", display_name: "原账号" } },
  }),
}));
vi.mock("@features/accounts/RuntimeAccessProvider", () => ({
  RuntimeAccessProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@app/entries/IndependentShell", () => ({
  IndependentShell: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@app/entries/navigation", () => ({ guardedNavigation: access.guard }));
vi.mock("@features/models/catalog/ModelServicePage", () => ({
  ModelServicePage: ({
    canWrite,
    canTest,
  }: {
    canWrite: boolean;
    canTest: boolean;
  }) => (
    <section aria-label="目录页面" data-write={canWrite} data-test={canTest} />
  ),
}));
vi.mock("@features/models/conversation/ModelTestPage", () => ({
  ModelTestPage: ({
    initialModelId,
    initialMode,
  }: {
    initialModelId: string | null;
    initialMode: string;
  }) => (
    <section
      aria-label="模型测试页面"
      data-model={initialModelId}
      data-mode={initialMode}
    />
  ),
}));
vi.mock("@features/models/ReadOnlyModels", () => ({
  ReadOnlyModels: () => <section aria-label="只读测试结果" />,
}));
vi.mock("@features/models/logs/ModelCallLogsPage", () => ({
  ModelCallLogsPage: ({
    currentAccount,
  }: {
    currentAccount: { id: string; name: string };
  }) => (
    <section aria-label="账号日志" data-owner={currentAccount.id}>
      {currentAccount.name}
    </section>
  ),
}));

afterEach(() => {
  access.permissions.clear();
  access.guard.mockReset();
  window.history.replaceState({}, "", "/");
});

test("independent catalogue keeps read/write/test permissions separate", async () => {
  window.history.replaceState({}, "", "/model-service");
  const view = render(<ModelsApplication />);
  const catalog = await screen.findByRole("region", { name: "目录页面" });
  expect(catalog).toHaveAttribute("data-write", "false");
  expect(catalog).toHaveAttribute("data-test", "false");
  access.permissions.add("configuration.manage");
  access.permissions.add("content.write");
  view.rerender(<ModelsApplication />);
  expect(catalog).toHaveAttribute("data-write", "true");
  expect(catalog).toHaveAttribute("data-test", "false");
  access.permissions.add("models.use");
  view.rerender(<ModelsApplication />);
  expect(catalog).toHaveAttribute("data-test", "true");
  const navigation = screen.getByRole("navigation", { name: "模型服务页面" });
  expect(
    within(navigation).getByRole("link", { current: "page" }),
  ).toHaveAttribute("href", "/model-service");
});

test("read-only model test exposes existing results and preserves model deep links for authorized users", async () => {
  window.history.replaceState(
    {},
    "",
    "/model-test?model=own-model&mode=synthesis",
  );
  const view = render(<ModelsApplication />);
  await screen.findByRole("region", { name: "只读测试结果" });
  expect(
    screen.queryByRole("region", { name: "模型测试页面" }),
  ).not.toBeInTheDocument();
  access.permissions.add("content.write");
  access.permissions.add("models.use");
  view.rerender(<ModelsApplication />);
  const testPage = await screen.findByRole("region", { name: "模型测试页面" });
  expect(testPage).toHaveAttribute("data-model", "own-model");
  expect(testPage).toHaveAttribute("data-mode", "synthesis");
});

test("log view uses current account and never mounts its reader without permission", async () => {
  window.history.replaceState({}, "", "/model-call-logs");
  const view = render(<ModelsApplication />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "没有调用日志读取权限",
  );
  expect(
    screen.queryByRole("region", { name: "账号日志" }),
  ).not.toBeInTheDocument();
  access.permissions.add("logs.read");
  view.rerender(<ModelsApplication />);
  expect(
    await screen.findByRole("region", { name: "账号日志" }),
  ).toHaveAttribute("data-owner", "owner-a");
});

test("document navigation participates in unsaved and active-work protection", async () => {
  window.history.replaceState({}, "", "/model-service");
  render(<ModelsApplication />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("link", { name: "模型测试" }));
  expect(access.guard).toHaveBeenCalledWith(expect.any(Function), true);
  expect(location.pathname).toBe("/model-service");
});

test("unknown paths do not fall back to an unrelated model page", async () => {
  window.history.replaceState({}, "", "/model-service/missing");
  render(<ModelsApplication />);
  expect(
    await screen.findByRole("heading", { name: "页面不存在" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "目录页面" }),
  ).not.toBeInTheDocument();
});
