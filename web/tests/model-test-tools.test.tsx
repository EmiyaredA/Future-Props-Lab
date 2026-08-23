import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ModelTestToolsPage } from "@features/models/tools";
import {
  createModelTestTool,
  executeModelTestTool,
  getModelTestTool,
} from "@features/models/api";

const { tool } = vi.hoisted(() => ({
  tool: {
    id: "tool-1",
    name: "get_weather",
    description: "查询指定城市的天气",
    parameter_count: 1,
    input_schema: {
      type: "object",
      properties: { city: { type: "string", description: "城市名称" } },
      required: ["city"],
    },
    mock_kind: "success" as const,
    mock_result: { weather: "晴", temperature: 26 },
    error_code: "mock_failure",
    error_message: "模拟工具执行失败",
    delay_ms: 500,
    enabled: true,
    revision: 0,
    last_used_at: "2026-08-23T12:00:00Z",
    created_at: "2026-08-23T10:00:00Z",
    updated_at: "2026-08-23T10:00:00Z",
    bound_conversation_count: 2,
    recent_calls: [],
  },
}));

vi.mock("@features/models/api", async () => {
  const actual = await vi.importActual<typeof import("@features/models/api")>(
    "@features/models/api",
  );
  return {
    ...actual,
    getModelTestTools: vi.fn().mockResolvedValue({
      items: [tool],
      overview: {
        total: 1,
        enabled: 1,
        failure: 0,
        today_runs: 3,
        recent: [tool],
      },
    }),
    getModelTestTool: vi.fn().mockResolvedValue(tool),
    createModelTestTool: vi.fn().mockResolvedValue(tool),
    updateModelTestTool: vi.fn().mockResolvedValue(tool),
    deleteModelTestTool: vi.fn().mockResolvedValue({ deleted: true }),
    executeModelTestTool: vi.fn().mockResolvedValue({
      id: "call-1",
      source: "dry_run",
      conversation_id: null,
      message_id: null,
      run_id: "",
      round_index: 0,
      tool_id: tool.id,
      tool_name: tool.name,
      tool_revision: 0,
      arguments: { city: "上海" },
      status: "completed",
      success: true,
      result: tool.mock_result,
      error_code: "",
      error_message: "",
      configured_delay_ms: 500,
      duration_ms: 503,
      created_at: tool.created_at,
      updated_at: tool.updated_at,
    }),
  };
});

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

test("lists test tools and completes the two-step create flow", async () => {
  const user = userEvent.setup();
  const onOpenTool = vi.fn();
  renderPage(<ModelTestToolsPage onOpenTool={onOpenTool} onBack={vi.fn()} />);
  expect((await screen.findAllByText("get_weather")).length).toBeGreaterThan(0);
  expect(screen.getByText("今日运行")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /新建测试工具/ }));
  await user.type(screen.getByLabelText("工具名称"), "search_news");
  await user.type(screen.getByLabelText("工具说明"), "搜索新闻");
  await user.click(screen.getByRole("button", { name: /下一步/ }));
  expect(screen.getByText("返回方式")).toBeInTheDocument();
  expect(screen.queryByText("人工返回")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "保存测试工具" }));
  await waitFor(() => expect(createModelTestTool).toHaveBeenCalled());
  expect(onOpenTool).toHaveBeenCalledWith("tool-1");
});

test("shows detail and runs deterministic JSON preview", async () => {
  const user = userEvent.setup();
  renderPage(
    <ModelTestToolsPage
      toolId="tool-1"
      onOpenTool={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  expect(
    await screen.findByRole("heading", { name: "get_weather" }),
  ).toBeInTheDocument();
  const editor = screen.getByLabelText("输入参数（JSON）");
  fireEvent.change(editor, {
    target: { value: JSON.stringify({ city: "上海" }) },
  });
  await user.click(screen.getByRole("button", { name: /运行测试/ }));
  await waitFor(() => expect(executeModelTestTool).toHaveBeenCalled());
  expect(await screen.findByText(/503/)).toBeInTheDocument();
  expect(getModelTestTool).toHaveBeenCalledWith("tool-1");
});

test("keeps the simple builder read-only for nested advanced schemas", async () => {
  const user = userEvent.setup();
  renderPage(<ModelTestToolsPage onOpenTool={vi.fn()} onBack={vi.fn()} />);
  await screen.findAllByText("get_weather");
  await user.click(screen.getByRole("button", { name: /新建测试工具/ }));
  await user.type(screen.getByLabelText("工具名称"), "nested_schema");
  await user.click(screen.getByRole("button", { name: /高级 JSON Schema/ }));
  const editor = screen.getByLabelText("高级 JSON Schema");
  fireEvent.change(editor, {
    target: {
      value: JSON.stringify({
        type: "object",
        properties: {
          location: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      }),
    },
  });
  fireEvent.blur(editor);
  expect(screen.getByText(/当前 Schema 含嵌套或高级结构/)).toBeInTheDocument();
});
