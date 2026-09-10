import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { WorkspacePermissionsProvider } from "@platform/auth/WorkspacePermissions";
import { ModelCallLogsPage } from "@features/models/logs/ModelCallLogsPage";
import * as models from "@features/models/api";
import * as accounts from "@features/accounts/platformApi";
import { LogFilterDrawer } from "@features/models/logs/LogFilters";
import { emptyLogFilters } from "@features/models/logs/modelCallLogPresentation";
vi.mock("@features/models/api", async (importOriginal) => ({
  ...(await importOriginal<typeof models>()),
  getLogs: vi.fn(),
  getLogStats: vi.fn(),
  getCatalog: vi.fn(),
  deleteLog: vi.fn(),
  batchDeleteLogs: vi.fn(),
}));
vi.mock("@features/accounts/platformApi", async (importOriginal) => ({
  ...(await importOriginal<typeof accounts>()),
  fetchLogWorkspaces: vi.fn(),
  fetchCrossWorkspaceLogs: vi.fn(),
  fetchCrossWorkspaceLogStats: vi.fn(),
}));
const row = {
  id: "local-log",
  model: "local-model",
  trace_id: "hidden-trace",
  call_source: "model_playground",
  provider_kind: "openai",
  total_tokens: 100,
  latency_ms: 300,
  status: "success",
  created_at: "2026-09-10T10:00:00Z",
};
const stats = {
  calls_today: 2,
  total_tokens_today: 100,
  avg_latency_ms_today: 300,
  errors_today: 0,
};
const permissions = [
  "logs.read",
  "configuration.manage",
  "logs.cross_workspace",
];
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = (perms = permissions) => (
    <QueryClientProvider client={client}>
      <WorkspacePermissionsProvider permissions={perms}>
        <ModelCallLogsPage
          currentWorkspace={{ id: "own", name: "自己的工作区" }}
        />
      </WorkspacePermissionsProvider>
    </QueryClientProvider>
  );
  return { ...render(tree()), tree };
}
beforeEach(() => {
  vi.mocked(models.getLogs).mockResolvedValue({
    items: [row],
    total: 1,
    page: 1,
    page_size: 25,
  });
  vi.mocked(models.getLogStats).mockResolvedValue(stats);
  vi.mocked(models.getCatalog).mockResolvedValue({
    revision: 0,
    providers: [],
  });
  vi.mocked(accounts.fetchLogWorkspaces).mockResolvedValue([
    { id: "own", name: "自己的工作区" },
    { id: "other", name: "其他工作区" },
  ]);
  vi.mocked(accounts.fetchCrossWorkspaceLogs).mockResolvedValue({
    items: [
      { ...row, id: "other-log", model: "other-model", workspace_id: "other" },
    ],
    total: 1,
    page: 1,
    page_size: 25,
    model_options: ["other-model", "older-model"],
  });
  vi.mocked(accounts.fetchCrossWorkspaceLogStats).mockResolvedValue({
    ...stats,
    calls_today: 8,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test("submits search on Enter, resets pagination and keeps trace IDs out of rows", async () => {
  const user = userEvent.setup();
  setup();
  await screen.findByText("local-model");
  expect(screen.queryByText("hidden-trace")).toBeNull();
  const search = screen.getByRole("textbox", { name: "搜索调用日志" });
  await user.type(search, "hello");
  expect(vi.mocked(models.getLogs).mock.lastCall?.[0].q).toBe("");
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(vi.mocked(models.getLogs).mock.lastCall?.[0]).toMatchObject({
      q: "hello",
      page: 1,
    }),
  );
  await user.click(screen.getByRole("combobox", { name: "调用源筛选" }));
  await user.click(screen.getByRole("option", { name: "思绪工坊写作" }));
  await waitFor(() =>
    expect(vi.mocked(models.getLogs).mock.lastCall?.[0].callSource).toBe(
      "thought_workshop_assistant",
    ),
  );
  expect(models.getLogStats).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "筛选" }));
  await user.click(screen.getByRole("button", { name: "重置" }));
  await waitFor(() => expect(search).toHaveValue(""));
  await user.type(search, "not-submitted");
  await user.click(screen.getByRole("button", { name: "筛选" }));
  await user.click(screen.getByRole("button", { name: "重置" }));
  expect(search).toHaveValue("");
});
test("uses one read-only table for other scopes and immediately hides it on permission revocation", async () => {
  const user = userEvent.setup();
  const view = setup();
  await screen.findByText("local-model");
  await user.click(
    screen.getByRole("checkbox", { name: "选择日志 local-log" }),
  );
  await user.click(screen.getByRole("combobox", { name: "日志工作区" }));
  await user.click(screen.getByRole("option", { name: "其他工作区" }));
  await screen.findByText("other-model");
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
  expect(screen.queryByText("local-model")).toBeNull();
  expect(accounts.fetchCrossWorkspaceLogStats).toHaveBeenLastCalledWith([
    "other",
  ]);
  await user.click(screen.getByRole("combobox", { name: "模型筛选" }));
  expect(
    screen.getByRole("option", { name: "older-model" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: "older-model" }));
  await user.click(screen.getByRole("combobox", { name: "日志工作区" }));
  await user.click(screen.getByRole("option", { name: "全部工作区" }));
  await waitFor(() =>
    expect(accounts.fetchCrossWorkspaceLogs).toHaveBeenLastCalledWith(
      ["other", "own"],
      expect.objectContaining({ model: "", page: 1 }),
    ),
  );
  expect(
    screen.getByRole("columnheader", { name: "工作区" }),
  ).toBeInTheDocument();
  view.rerender(view.tree(["logs.read"]));
  expect(screen.queryByText("other-model")).toBeNull();
  expect(screen.queryByRole("combobox", { name: "日志工作区" })).toBeNull();
  await screen.findByText("local-model");
  expect(screen.queryByRole("checkbox")).toBeNull();
});
test("retains failed deletion for retry and clears a successful selection", async () => {
  const user = userEvent.setup();
  setup();
  vi.mocked(models.batchDeleteLogs)
    .mockRejectedValueOnce(new Error("暂时无法删除"))
    .mockResolvedValueOnce({ deleted: 1 });
  await screen.findByText("local-model");
  await user.click(
    screen.getByRole("checkbox", { name: "选择日志 local-log" }),
  );
  await user.click(screen.getByRole("button", { name: "批量删除（1）" }));
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "删除日志",
    }),
  );
  await user.click(await screen.findByRole("button", { name: "重试删除" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByRole("button", { name: "批量删除" })).toBeDisabled();
});
test("blocks reversed dates and does not apply when the drawer is closed", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const close = vi.fn();
  render(
    <LogFilterDrawer
      filters={{ ...emptyLogFilters, from: "2026-09-10", to: "2026-09-09" }}
      models={[]}
      onChange={change}
      onClose={close}
      onReset={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "开始日期不能晚于结束日期",
  );
  expect(screen.getByRole("button", { name: "应用筛选" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "关闭筛选" }));
  expect(change).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

test("does not show a late cross-workspace response after returning to current scope", async () => {
  let resolve!: (
    value: Awaited<ReturnType<typeof accounts.fetchCrossWorkspaceLogs>>,
  ) => void;
  vi.mocked(accounts.fetchCrossWorkspaceLogs).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const user = userEvent.setup();
  setup();
  await screen.findByText("local-model");
  await user.click(screen.getByRole("combobox", { name: "日志工作区" }));
  await user.click(screen.getByRole("option", { name: "其他工作区" }));
  expect(screen.queryByText("local-model")).toBeNull();
  await user.click(screen.getByRole("combobox", { name: "日志工作区" }));
  await user.click(
    screen.getByRole("option", { name: "当前工作区 · 自己的工作区" }),
  );
  resolve({
    items: [
      { ...row, id: "late", workspace_id: "other", model: "late-other-model" },
    ],
    total: 1,
    page: 1,
    page_size: 25,
    model_options: [],
  });
  await screen.findByText("local-model");
  expect(screen.queryByText("late-other-model")).toBeNull();
});

test("retries a failed query without presenting it as an empty list", async () => {
  vi.mocked(models.getLogs).mockRejectedValueOnce(new Error("查询失败"));
  const user = userEvent.setup();
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("查询失败");
  expect(screen.queryByText("暂无调用日志")).toBeNull();
  await user.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("local-model");
});

test("returns to the last valid page when deletion empties the final page", async () => {
  let deleted = false;
  vi.mocked(models.getLogs).mockImplementation(async (filters) => ({
    items: deleted && filters.page > 1 ? [] : [row],
    total: deleted ? 25 : 26,
    page: filters.page,
    page_size: 25,
  }));
  vi.mocked(models.batchDeleteLogs).mockImplementation(async () => {
    deleted = true;
    return { deleted: 1 };
  });
  const user = userEvent.setup();
  setup();
  await screen.findByText("local-model");
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText("local-model");
  await user.click(
    screen.getByRole("checkbox", { name: "选择日志 local-log" }),
  );
  await user.click(screen.getByRole("button", { name: "批量删除（1）" }));
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "删除日志",
    }),
  );
  await waitFor(() =>
    expect(vi.mocked(models.getLogs).mock.lastCall?.[0].page).toBe(1),
  );
  expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
});

test("applies a valid date range only after explicit submission", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const close = vi.fn();
  const filters = {
    ...emptyLogFilters,
    from: "2026-09-01",
    to: "2026-09-10",
    page: 3,
  };
  render(
    <LogFilterDrawer
      filters={filters}
      models={[]}
      onChange={change}
      onClose={close}
      onReset={vi.fn()}
    />,
  );
  expect(change).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "应用筛选" }));
  expect(change).toHaveBeenCalledWith({ ...filters, page: 1 });
  expect(close).toHaveBeenCalledOnce();
});
