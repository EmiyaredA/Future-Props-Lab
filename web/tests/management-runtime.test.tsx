import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { RuntimePage } from "@features/accounts/management/RuntimePage";
import { RuntimeAccessContext } from "@features/accounts/useRuntimeAccess";

const mocked = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@platform/api/client", () => ({
  api: { GET: mocked.get, POST: mocked.post },
  unwrap: async (value: unknown) => value,
}));
vi.mock("@features/accounts/api", () => ({ reauthenticate: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocked.get.mockImplementation(async (path: string) => {
    if (path.endsWith("application"))
      return { phase: "stopped", error: "", force_stop_available: false };
    if (path.includes("jobs/"))
      return { id: "job", status: "completed", revision: 1 };
    return { phase: "off", url: "https://example.test", error: "" };
  });
  mocked.post.mockResolvedValue({ id: "job", status: "queued", revision: 0 });
});
function page(
  local: boolean,
  section: "application" | "access" = "application",
) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <RuntimeAccessContext value={local}>
        <RuntimePage section={section} ownerId="admin" />
      </RuntimeAccessContext>
    </QueryClientProvider>,
  );
}
test("public administrators can inspect state but see no host control or logs", async () => {
  page(false);
  await screen.findByText("已停止");
  expect(
    screen.queryByRole("button", { name: "启动应用" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "查看应用日志" }),
  ).not.toBeInTheDocument();
  expect(mocked.post).not.toHaveBeenCalled();
});
test("local application controls require confirmation and submit an idempotency ID", async () => {
  const user = userEvent.setup();
  page(true);
  await screen.findByText("已停止");
  await user.click(screen.getByRole("button", { name: "启动应用" }));
  expect(mocked.post).not.toHaveBeenCalled();
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toBeVisible();
  await user.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() =>
    expect(mocked.post).toHaveBeenCalledWith(
      "/v1/management/application/actions",
      { body: { action: "start", request_id: expect.any(String) } },
    ),
  );
});
test("the two access targets have independent controls", async () => {
  const user = userEvent.setup();
  page(true, "access");
  const buttons = await screen.findAllByRole("button", { name: "开启公网" });
  expect(buttons).toHaveLength(2);
  await user.click(buttons[1]);
  await user.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() =>
    expect(mocked.post).toHaveBeenCalledWith(
      "/v1/management/access/{target}/actions",
      {
        params: { path: { target: "management" } },
        body: { action: "public_start", request_id: expect.any(String) },
      },
    ),
  );
});

test("a lost command response is reconciled with the original idempotency ID", async () => {
  mocked.post.mockRejectedValueOnce(new Error("Connection lost"));
  const user = userEvent.setup();
  page(true);
  await screen.findByText("已停止");
  await user.click(screen.getByRole("button", { name: "启动应用" }));
  await user.click(screen.getByRole("button", { name: "确认" }));
  await screen.findByRole("button", { name: "核对操作回执" });
  expect(mocked.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "启动应用" })).toBeDisabled();
  const first = mocked.post.mock.calls[0][1].body.request_id;
  await user.click(screen.getByRole("button", { name: "核对操作回执" }));
  await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(2));
  expect(mocked.post.mock.calls[1][1].body.request_id).toBe(first);
});

test("expired sensitive authentication can be renewed to read host logs", async () => {
  let verified = false;
  mocked.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/logs")) {
      if (!verified) throw new Error("reauthentication_required");
      return { lines: ["safe log"] };
    }
    return { phase: "stopped", error: "", force_stop_available: false };
  });
  const { reauthenticate } = await import("@features/accounts/api");
  vi.mocked(reauthenticate).mockImplementation(async () => {
    verified = true;
  });
  const user = userEvent.setup();
  page(true);
  await user.click(await screen.findByRole("button", { name: "查看应用日志" }));
  await user.click(
    await screen.findByRole("button", { name: "重新验证身份以查看日志" }),
  );
  await user.type(screen.getByLabelText("当前密码"), "password");
  await user.click(screen.getByRole("button", { name: "验证并执行" }));
  await screen.findByText("safe log");
  expect(mocked.post).not.toHaveBeenCalled();
});
