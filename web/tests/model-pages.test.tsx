import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ModelCallLogsPage } from "@features/models/ModelCallLogsPage";
import { ModelServicePage } from "@features/models/ModelServicePage";

vi.mock("@features/models/api", async () => {
  const actual = await vi.importActual<typeof import("@features/models/api")>(
    "@features/models/api",
  );
  return {
    ...actual,
    getCatalog: vi.fn().mockResolvedValue({
      revision: 2,
      providers: [
        {
          id: "p1",
          name: "主模型网关",
          kind: "openai",
          base_url: "https://example.test/v1",
          enabled: true,
          has_api_key: true,
          api_key_hint: "1234",
          models: [
            {
              id: "m1",
              provider_id: "p1",
              slug: "model-x",
              label: "Model X",
              description: "",
              capabilities: ["chat"],
              enabled: true,
            },
          ],
        },
      ],
    }),
    getLogs: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 }),
    getLogStats: vi.fn().mockResolvedValue({
      calls_today: 0,
      total_tokens_today: 0,
      avg_latency_ms_today: 0,
      errors_today: 0,
    }),
  };
});

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

test("shows provider catalog and model diagnostics entry", async () => {
  renderWithQuery(<ModelServicePage onOpenLogs={() => undefined} />);
  expect(await screen.findByText("主模型网关")).toBeInTheDocument();
  expect(await screen.findByText("Model X")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "测试调用" })).toBeEnabled();
});

test("shows a useful empty state for call logs", async () => {
  renderWithQuery(<ModelCallLogsPage />);
  expect(await screen.findByText("暂无调用日志")).toBeInTheDocument();
  expect(
    screen.getByText("在模型服务页执行测试调用后，结果会显示在这里。"),
  ).toBeInTheDocument();
});
