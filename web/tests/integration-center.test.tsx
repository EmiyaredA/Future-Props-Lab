import { act, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import {
  IntegrationCenterPage,
  type IntegrationKind,
} from "@features/integrations/IntegrationCenterPage";
import {
  getMcpServers,
  getSkills,
  getToolApis,
  updateToolApi,
  validateToolApi,
} from "@features/integrations/api";
import { ApiError } from "@platform/api/client";

vi.mock("@features/integrations/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/integrations/api")
  >("@features/integrations/api");
  return {
    ...actual,
    getToolApis: vi.fn(),
    getMcpServers: vi.fn(),
    getSkills: vi.fn(),
    getMcpTools: vi.fn().mockResolvedValue([]),
    updateToolApi: vi.fn(),
    validateToolApi: vi.fn(),
  };
});

const toolApi = {
  sensitive_result: false,
  id: "api-1",
  name: "订单查询",
  description: "读取订单状态",
  method: "GET",
  url: "https://api.example.com/orders",
  auth_kind: "bearer",
  auth_header_name: "",
  has_secret: true,
  secret_hint: "1234",
  parameters_schema: { type: "object", properties: {} },
  query_template: {},
  body_template: null,
  tags: ["订单"],
  enabled: true,
  status: "healthy" as const,
  status_message: "HTTP 200",
  last_checked_at: "2026-08-23T10:00:00Z",
  revision: 1,
  created_at: "2026-08-23T09:00:00Z",
  updated_at: "2026-08-23T10:00:00Z",
};

function renderPage(
  kind: "tool-apis" | "mcp" | "skills",
  canManage = true,
  onKindChange = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <IntegrationCenterPage
        kind={kind}
        canManage={canManage}
        onKindChange={onKindChange}
      />
    </QueryClientProvider>,
  );
  return { onKindChange };
}

function StatefulIntegrationCenter() {
  const [kind, setKind] = useState<IntegrationKind>("tool-apis");
  return <IntegrationCenterPage kind={kind} canManage onKindChange={setKind} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getToolApis).mockResolvedValue({
    items: [toolApi],
    overview: {
      primary_count: 1,
      failed_count: 0,
      tertiary_count: 1,
      recent: [],
    },
  });
  vi.mocked(getMcpServers).mockResolvedValue({
    items: [],
    overview: {
      primary_count: 0,
      failed_count: 0,
      tertiary_count: 0,
      recent: [],
    },
  });
  vi.mocked(getSkills).mockResolvedValue({
    items: [],
    enabled_count: 0,
    draft_count: 0,
    version_count: 0,
  });
  vi.mocked(validateToolApi).mockResolvedValue({
    check: {
      id: "check-1",
      resource_kind: "tool_api",
      resource_id: toolApi.id,
      resource_name: toolApi.name,
      ok: true,
      status_code: 200,
      latency_ms: 12,
      summary: "HTTP 200",
      created_at: "2026-08-23T10:01:00Z",
    },
    response_preview: '{"ok":true}',
    content_type: "application/json",
  });
  vi.mocked(updateToolApi).mockResolvedValue({ ...toolApi, revision: 2 });
});

test("switches deep-link tabs through the app callback", async () => {
  const user = userEvent.setup();
  const { onKindChange } = renderPage("tool-apis");
  expect(
    await screen.findByRole("heading", { name: "集成中心" }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Workspace 能力目录/)).not.toBeInTheDocument();
  await screen.findByText("订单查询");
  await user.click(screen.getByRole("tab", { name: "MCP" }));
  expect(onKindChange).toHaveBeenCalledWith("mcp");
  expect(screen.getByRole("tab", { name: "工具 API" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("keeps independent search state while switching tabs", async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <StatefulIntegrationCenter />
    </QueryClientProvider>,
  );
  const toolSearch = await screen.findByRole("textbox", {
    name: "搜索工具 API",
  });
  await user.type(toolSearch, "订单");
  await user.click(screen.getByRole("tab", { name: "MCP" }));
  await user.type(
    await screen.findByRole("textbox", { name: "搜索 MCP" }),
    "服务",
  );
  await user.click(screen.getByRole("tab", { name: "工具 API" }));
  expect(screen.getByRole("textbox", { name: "搜索工具 API" })).toHaveValue(
    "订单",
  );
});

test("keeps member view read-only while retaining search and cards", async () => {
  const user = userEvent.setup();
  renderPage("tool-apis", false);
  expect(await screen.findByText("订单查询")).toBeInTheDocument();
  expect(screen.getByText(/当前为只读模式/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "新建工具 API" })).toBeNull();
  expect(screen.queryByRole("button", { name: "验证 订单查询" })).toBeNull();

  await user.type(
    screen.getByRole("textbox", { name: "搜索工具 API" }),
    "不存在",
  );
  expect(screen.getByText("没有匹配的工具 API。")).toBeInTheDocument();
});

test("validates a tool API and shows only the transient preview", async () => {
  const user = userEvent.setup();
  renderPage("tool-apis");
  await screen.findByText("订单查询");
  await user.click(screen.getByRole("button", { name: "验证 订单查询" }));
  await user.click(screen.getByRole("button", { name: "开始验证" }));
  await waitFor(() =>
    expect(validateToolApi).toHaveBeenCalledWith(toolApi, {}),
  );
  expect(await screen.findByText('{"ok":true}')).toBeInTheDocument();
});

test("preserves editing state and explains a CAS conflict", async () => {
  const user = userEvent.setup();
  vi.mocked(updateToolApi).mockRejectedValueOnce(
    new ApiError(
      "内容已被其他操作更新",
      { code: "revision_conflict", current: { ...toolApi, revision: 2 } },
      409,
    ),
  );
  renderPage("tool-apis");
  await screen.findByText("订单查询");
  await user.click(screen.getByRole("button", { name: "编辑 订单查询" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "编辑工具 API" })).toBeVisible();
});

test("renders truthful empty states for MCP and Skill catalogs", async () => {
  const first = renderPage("mcp");
  expect(await screen.findByText("还没有 MCP 服务。")).toBeInTheDocument();
  first.onKindChange.mockClear();

  renderPage("skills", false);
  expect(
    await screen.findByText("还没有 Skill，上传 ZIP 后会先进行安全校验。"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "上传 Skill" })).toBeNull();
});

test("agent opens an editor only after loading, without submitting", async () => {
  renderPage("tool-apis");
  await screen.findByText("订单查询");
  const complete = vi.fn();
  window.dispatchEvent(
    new CustomEvent("future-props:integration-open", {
      detail: {
        request: {
          id: "open-edit",
          kind: "tool-api",
          resource_id: "api-1",
          view: "edit",
        },
        active: () => true,
        complete,
      },
    }),
  );
  await screen.findByRole("dialog", { name: "编辑工具 API" });
  await waitFor(() => expect(complete).toHaveBeenCalledWith(true));
  expect(updateToolApi).not.toHaveBeenCalled();
});

test("agent missing target reports failure", async () => {
  renderPage("tool-apis");
  await screen.findByText("订单查询");
  const complete = vi.fn();
  window.dispatchEvent(
    new CustomEvent("future-props:integration-open", {
      detail: {
        request: {
          id: "missing-edit",
          kind: "tool-api",
          resource_id: "missing",
          view: "edit",
        },
        active: () => true,
        complete,
      },
    }),
  );
  await waitFor(() => expect(complete).toHaveBeenCalledWith(false));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("external updates preserve filters and defer while a draft is dirty", async () => {
  const user = userEvent.setup();
  renderPage("tool-apis");
  await screen.findByText("订单查询");
  await user.type(
    screen.getByRole("textbox", { name: "搜索工具 API" }),
    "订单",
  );
  act(() => {
    window.dispatchEvent(
      new CustomEvent("future-props:integration-change", {
        detail: ["tool-apis"],
      }),
    );
  });
  await waitFor(() => expect(getToolApis).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("textbox", { name: "搜索工具 API" })).toHaveValue(
    "订单",
  );
  await user.click(screen.getByRole("button", { name: "编辑 订单查询" }));
  await user.type(screen.getByRole("textbox", { name: "名称" }), "草稿");
  act(() => {
    window.dispatchEvent(
      new CustomEvent("future-props:integration-change", {
        detail: ["tool-apis"],
      }),
    );
  });
  await screen.findByText(/集成已被外部更新/);
  expect(getToolApis).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue(
    "订单查询草稿",
  );
  await user.keyboard("{Escape}");
  await screen.findByRole("alertdialog");
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue(
    "订单查询草稿",
  );
  await user.click(screen.getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  await user.click(
    screen.getByRole("button", { name: "处理完当前编辑后查看更新" }),
  );
  await waitFor(() => expect(getToolApis).toHaveBeenCalledTimes(3));
});
