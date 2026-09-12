import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { InferenceTasks } from "../src/features/models/inference/InferenceTasks";
import { WorkspacePermissionsProvider } from "../src/platform/auth/WorkspacePermissions";
import { api } from "../src/platform/api/client";

vi.mock("../src/platform/api/client", () => ({
  api: { GET: vi.fn(), POST: vi.fn() },
  unwrap: async (response: { data: unknown }) => response.data,
}));
const task = {
  id: "sdk-created-task",
  model_slug: "Example model",
  status: "completed",
  progress: 100,
  request_payload: { prompt: "test" },
  result: {},
  result_available: true,
  revision: 4,
  can_retry_materialization: false,
  result_filename: "result.png",
  error_message: null,
};
function show(
  permissions: string[] = ["content.read", "content.write", "models.use"],
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <WorkspacePermissionsProvider permissions={permissions}>
        <InferenceTasks workspaceId="space-one" />
      </WorkspacePermissionsProvider>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => vi.clearAllMocks());

test("shows SDK tasks and transfers results through the official API", async () => {
  vi.mocked(api.GET).mockResolvedValue({
    data: { items: [task], total: 1 },
  } as never);
  vi.mocked(api.POST).mockResolvedValue({ data: {} } as never);
  const client = show();
  expect(await screen.findByText("Example model")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "存入文件库" }));
  expect(await screen.findByRole("status")).toHaveTextContent("结果已保存");
  expect(api.POST).toHaveBeenCalledWith(
    "/v1/model-inference/tasks/{task_id}/save-to-library",
    { params: { path: { task_id: task.id } } },
  );
  client.clear();
});

test("read-only viewers can inspect and download but cannot save or retry", async () => {
  vi.mocked(api.GET).mockResolvedValue({
    data: { items: [{ ...task, can_retry_materialization: true }], total: 1 },
  } as never);
  const client = show(["content.read"]);
  expect(await screen.findByRole("button", { name: "下载结果" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "存入文件库" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "重试保存结果" }),
  ).not.toBeInTheDocument();
  client.clear();
});

test("retrying materialization carries the saved revision", async () => {
  vi.mocked(api.GET).mockResolvedValue({
    data: {
      items: [
        {
          ...task,
          status: "failed",
          can_retry_materialization: true,
          result_available: false,
        },
      ],
      total: 1,
    },
  } as never);
  vi.mocked(api.POST).mockResolvedValue({ data: task } as never);
  const client = show();
  await userEvent.click(
    await screen.findByRole("button", { name: "重试保存结果" }),
  );
  await waitFor(() =>
    expect(api.POST).toHaveBeenCalledWith(
      "/v1/model-inference/tasks/{task_id}/retry-materialization",
      {
        params: { path: { task_id: task.id } },
        body: { expected_revision: 4 },
      },
    ),
  );
  client.clear();
});
