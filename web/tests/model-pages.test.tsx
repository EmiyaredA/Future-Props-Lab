import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ModelCallLogsPage } from "@features/models/ModelCallLogsPage";
import { ModelServicePage } from "@features/models/ModelServicePage";
import { ModelTestPage } from "@features/models/ModelTestPage";
import {
  getModelTestConversation,
  getModelTestConversations,
  patchModelTestConversation,
} from "@features/models/api";

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
    getModelTestConversations: vi.fn().mockResolvedValue({
      items: [
        {
          id: "c1",
          title: "测试对话",
          model_id: "m1",
          model_slug: "model-x",
          revision: 2,
          created_at: "2026-08-03T00:00:00Z",
          updated_at: "2026-08-03T00:00:00Z",
        },
      ],
    }),
    getModelTestConversation: vi.fn().mockResolvedValue({
      id: "c1",
      title: "测试对话",
      model_id: "m1",
      model_slug: "model-x",
      revision: 2,
      created_at: "2026-08-03T00:00:00Z",
      updated_at: "2026-08-03T00:00:00Z",
      system_prompt: "",
      temperature: 0.7,
      max_tokens: 1024,
      messages: [
        {
          id: "msg1",
          turn_id: "t1",
          role: "assistant",
          content:
            "**安全 Markdown** <img src=x onerror=alert(1)>\n\n```python\ndef hello():\n    print('ok')\n```",
          model_slug: "model-x",
          status: "completed",
          error_message: null,
          created_at: "2026-08-03T00:00:00Z",
        },
      ],
    }),
    patchModelTestConversation: vi.fn().mockResolvedValue({
      id: "c1",
      title: "测试对话",
      model_id: "m1",
      model_slug: "model-x",
      revision: 3,
      created_at: "2026-08-03T00:00:00Z",
      updated_at: "2026-08-03T00:00:00Z",
      system_prompt: "",
      temperature: 0.7,
      max_tokens: 1024,
      messages: [],
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
  const { container } = renderWithQuery(
    <ModelServicePage onOpenLogs={() => undefined} />,
  );
  expect(await screen.findByText("主模型网关")).toBeInTheDocument();
  expect(await screen.findByText("Model X")).toBeInTheDocument();
  expect(container.querySelector(".model-glyph")).toBeNull();
  expect(screen.getByText("能力")).toBeInTheDocument();
  expect(screen.getByText("状态")).toBeInTheDocument();
  expect(screen.getAllByText("已启用")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "测试调用" })).toBeEnabled();
});

test("shows a useful empty state for call logs", async () => {
  renderWithQuery(<ModelCallLogsPage />);
  expect(await screen.findByText("暂无调用日志")).toBeInTheDocument();
  expect(
    screen.getByText("快速诊断与模型测试产生的结果会显示在这里。"),
  ).toBeInTheDocument();
});

test("renders persistent model test workspace with safe markdown", async () => {
  const user = userEvent.setup();
  const { container } = renderWithQuery(<ModelTestPage />);
  expect(await screen.findByText("测试对话")).toBeInTheDocument();
  expect(await screen.findByText("安全 Markdown")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "测试模型" })).toBeInTheDocument();
  const copyCodeButton = screen.getByRole("button", { name: "复制代码" });
  expect(copyCodeButton).toBeInTheDocument();
  expect(container.querySelector("code.hljs")).toBeInTheDocument();
  expect(container.querySelector(".hljs-keyword")).toHaveTextContent("def");
  await user.click(copyCodeButton);
  expect(await navigator.clipboard.readText()).toBe(
    "def hello():\n    print('ok')",
  );
  expect(
    screen.getByRole("button", { name: "复制原始输出" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "恢复默认参数" }));
  expect(vi.mocked(patchModelTestConversation)).toHaveBeenCalledWith("c1", 2, {
    system_prompt: "",
    temperature: 0.7,
    max_tokens: 1024,
  });
  expect(container.querySelector("select")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
});

test("filters conversations locally", async () => {
  vi.mocked(getModelTestConversations).mockResolvedValueOnce({
    items: [
      {
        id: "c1",
        title: "测试对话",
        model_id: "m1",
        model_slug: "model-x",
        revision: 2,
        created_at: "2026-08-03T00:00:00Z",
        updated_at: "2026-08-03T00:00:00Z",
      },
      {
        id: "c2",
        title: "代码效果",
        model_id: "m1",
        model_slug: "model-x",
        revision: 1,
        created_at: "2026-08-03T00:00:00Z",
        updated_at: "2026-08-03T00:00:00Z",
      },
    ],
  });
  const user = userEvent.setup();
  renderWithQuery(<ModelTestPage />);
  expect(await screen.findByText("代码效果")).toBeInTheDocument();
  expect(screen.getByText("共 2 个对话")).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "搜索对话" }), "代码");
  expect(screen.queryByText("测试对话")).not.toBeInTheDocument();
  expect(screen.getByText("代码效果")).toBeInTheDocument();
});

test("keeps raw provider errors inside the detail dialog", async () => {
  const rawError =
    "Client error '401 Unauthorized' for url 'https://api.example.test/v1/chat/completions'";
  vi.mocked(getModelTestConversation).mockResolvedValueOnce({
    id: "c1",
    title: "测试对话",
    model_id: "m1",
    model_slug: "model-x",
    revision: 2,
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
    system_prompt: "",
    temperature: 0.7,
    max_tokens: 1024,
    messages: [
      {
        id: "msg-error",
        turn_id: "t-error",
        role: "assistant",
        content: "",
        model_slug: "model-x",
        status: "error",
        error_message: rawError,
        created_at: "2026-08-03T00:00:00Z",
      },
    ],
  });
  const user = userEvent.setup();
  renderWithQuery(<ModelTestPage />);
  expect(await screen.findByText("认证失败")).toBeInTheDocument();
  expect(screen.queryByText(rawError)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看详情" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(rawError);
});
