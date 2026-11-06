import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "@platform/api/client";
import { ValidationRecoveryPanel } from "@features/integrations/ValidationRecoveryPanel";
import {
  getValidationAttempts,
  reconcileValidationAttempt,
} from "@features/integrations/api";

vi.mock("@features/integrations/api", () => ({
  getValidationAttempts: vi.fn(),
  reconcileValidationAttempt: vi.fn(),
}));

const pending = {
  id: "80e59f49-4841-4309-9205-bfdc01fbcc0b",
  kind: "mcp.validate" as const,
  connection_id: "connection-a",
  status: "unknown" as const,
  released: false,
  created_at: "2026-11-03T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getValidationAttempts).mockResolvedValue({
    items: [pending],
    has_more: false,
  });
});

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ValidationRecoveryPanel />
    </QueryClientProvider>,
  );
}

test("checks the original receipt without creating a new validation", async () => {
  const user = userEvent.setup();
  vi.mocked(reconcileValidationAttempt).mockResolvedValue({
    id: pending.id,
    status: "completed",
    released: true,
  });
  show();
  expect(await screen.findByText(/MCP 验证/)).toBeInTheDocument();
  expect(screen.getByText(/没有可信结束回执时继续保留/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "检查回执" }));
  await waitFor(() =>
    expect(reconcileValidationAttempt).toHaveBeenCalledWith(
      pending.id,
      expect.anything(),
    ),
  );
  expect(
    await screen.findByText("已确认结束并释放验证额度。 ".trim()),
  ).toBeInTheDocument();
});

test("unconfirmed remote execution remains visible with its capacity retained", async () => {
  const user = userEvent.setup();
  vi.mocked(reconcileValidationAttempt).mockRejectedValue(
    new ApiError(
      "尚未收到可信结束回执，额度继续保留",
      {
        code: "integration_validation_evidence_pending",
        detail: "尚未收到可信结束回执，额度继续保留",
      },
      409,
    ),
  );
  show();
  await user.click(await screen.findByRole("button", { name: "检查回执" }));
  expect(await screen.findByRole("status")).toHaveTextContent("额度继续保留");
  expect(screen.getByText(/MCP 验证/)).toBeInTheDocument();
});

test("paginates pending attempts without hiding older unresolved entries", async () => {
  const user = userEvent.setup();
  vi.mocked(getValidationAttempts).mockImplementation(async (offset) =>
    offset === 100
      ? {
          items: [
            {
              ...pending,
              kind: "tool.validate" as const,
              id: "bbbe59f9-4841-4309-9205-bfdc01fbcc0b",
              connection_id: "connection-b",
            },
          ],
          has_more: false,
        }
      : { items: [pending], has_more: true },
  );
  show();
  await user.click(await screen.findByRole("button", { name: "下一页" }));
  expect(await screen.findByText(/工具 API 验证/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "上一页" }));
  expect(await screen.findByText(/MCP 验证/)).toBeInTheDocument();
});
