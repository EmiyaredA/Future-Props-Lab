import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import {
  ModelTestToolCallList,
  ModelTestToolSelector,
} from "@features/models/conversation/ModelTestToolControls";
import { getModelTestTools } from "@features/models/api";

vi.mock("@features/models/api", async () => {
  const actual = await vi.importActual<typeof import("@features/models/api")>(
    "@features/models/api",
  );
  return {
    ...actual,
    getModelTestTools: vi.fn().mockResolvedValue({
      items: [
        {
          id: "tool-1",
          name: "get_weather",
          description: "查询天气",
          parameter_count: 1,
          mock_kind: "success",
          delay_ms: 0,
          enabled: true,
          revision: 0,
          last_used_at: null,
          created_at: "2026-08-23T12:00:00Z",
          updated_at: "2026-08-23T12:00:00Z",
        },
      ],
      overview: {
        total: 1,
        enabled: 1,
        failure: 0,
        today_runs: 0,
        recent: [],
      },
    }),
  };
});

function renderWithQuery(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

test("selects an enabled tool and saves its ordered id", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderWithQuery(
    <ModelTestToolSelector
      selected={[]}
      supported
      disabled={false}
      onSave={onSave}
    />,
  );
  await user.click(screen.getByRole("button", { name: /选择测试工具/ }));
  await user.click(
    await screen.findByRole("checkbox", { name: /get_weather/ }),
  );
  await user.click(screen.getByRole("button", { name: "保存选择" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(["tool-1"]));
});

test("disables selection for unsupported models and expands persisted steps", async () => {
  const user = userEvent.setup();
  renderWithQuery(
    <>
      <ModelTestToolSelector
        selected={[]}
        supported={false}
        disabled={false}
        onSave={vi.fn()}
      />
      <ModelTestToolCallList
        calls={[
          {
            id: "call-1",
            tool_name: "get_weather",
            arguments: { city: "上海" },
            status: "completed",
            success: true,
            result: { weather: "晴" },
            error_code: "",
            error_message: "",
            duration_ms: 3,
          },
        ]}
      />
    </>,
  );
  expect(screen.getByText("当前模型不支持工具调用")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /选择测试工具/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: /get_weather/ }));
  expect(screen.getByText(/"city": "上海"/)).toBeInTheDocument();
  expect(screen.getByText(/"weather": "晴"/)).toBeInTheDocument();
  expect(getModelTestTools).not.toHaveBeenCalled();
});
