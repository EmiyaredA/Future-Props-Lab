import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ModelTemplatesPage } from "@features/accounts/ModelTemplatesPage";

const mocks = vi.hoisted(() => ({
  fetchTemplate: vi.fn(),
  saveTemplate: vi.fn(),
  previewTemplate: vi.fn(),
  startSyncJob: vi.fn(),
  updateModel: vi.fn(),
  createProvider: vi.fn(),
  getCatalog: vi.fn(),
}));
vi.mock("@features/accounts/platformApi", async () => ({
  ...(await vi.importActual("@features/accounts/platformApi")),
  ...mocks,
}));
vi.mock("@features/models/api", async () => ({
  ...(await vi.importActual("@features/models/api")),
  updateModel: mocks.updateModel,
  createProvider: mocks.createProvider,
  getCatalog: mocks.getCatalog,
  getModelCategories: vi.fn().mockResolvedValue({
    items: [{ id: "text_generation", label: "文本生成", type: "text" }],
  }),
}));

const initial = {
  role: "member",
  revision: 3,
  value: {
    suppliers: [{ template_key: "supplier-stable", name: "平台供应商" }],
    providers: [
      {
        template_key: "connection-stable",
        supplier_key: "supplier-stable",
        name: "平台网关",
        kind: "openai",
        base_url: "https://example.test",
        enabled: true,
        has_api_key: true,
        api_key_hint: "1234",
        models: [
          {
            template_key: "model-stable",
            slug: "shared-model",
            label: "共享模型",
            description: "",
            enabled: true,
            capabilities: ["chat"],
            categories: ["text_generation"],
          },
        ],
      },
    ],
    defaults: { chat: "model-stable" },
  },
};

test("the management adapter edits a template draft with the shared catalog and separates save from synchronization", async () => {
  const user = userEvent.setup();
  mocks.fetchTemplate.mockResolvedValue(initial);
  mocks.saveTemplate.mockImplementation(async (_role, body) => ({
    ...initial,
    revision: 4,
    value: body.value,
  }));
  mocks.previewTemplate.mockResolvedValue({
    id: "preview",
    revision: 0,
    status: "preview",
    items: [],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ModelTemplatesPage />
    </QueryClientProvider>,
  );
  await user.click(
    await screen.findByRole("button", { name: "共享模型 操作" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "编辑 共享模型" }));
  await user.clear(screen.getByRole("textbox", { name: "显示名称" }));
  await user.type(
    screen.getByRole("textbox", { name: "显示名称" }),
    "模板草稿模型",
  );
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("模板草稿模型")).toBeVisible();
  expect(mocks.updateModel).not.toHaveBeenCalled();
  expect(mocks.getCatalog).not.toHaveBeenCalled();
  expect(mocks.saveTemplate).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "预览同步已有空间" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "保存角色模板" }));
  await waitFor(() => expect(mocks.saveTemplate).toHaveBeenCalledOnce());
  expect(mocks.saveTemplate).toHaveBeenCalledWith(
    "member",
    expect.objectContaining({
      expected_revision: 3,
      value: expect.objectContaining({
        suppliers: initial.value.suppliers,
        providers: [
          expect.objectContaining({
            template_key: "connection-stable",
            supplier_key: "supplier-stable",
            api_key: "",
            models: [
              expect.objectContaining({
                template_key: "model-stable",
                label: "模板草稿模型",
              }),
            ],
          }),
        ],
      }),
    }),
  );
  expect(mocks.startSyncJob).not.toHaveBeenCalled();
  expect(mocks.previewTemplate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "预览同步已有空间" }));
  expect(mocks.previewTemplate).toHaveBeenCalledWith("member", 4);
  expect(mocks.startSyncJob).not.toHaveBeenCalled();
});
