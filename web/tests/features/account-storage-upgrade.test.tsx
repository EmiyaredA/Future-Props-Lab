import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { AccountStorageUpgrade } from "@features/accounts/AccountStorageUpgrade";
import { reauthenticate, type AuthMe } from "@features/accounts/api";

const transport = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@features/accounts/api", async () => ({
  ...(await vi.importActual("@features/accounts/api")),
  reauthenticate: vi.fn(),
}));
vi.mock("@platform/api/client", async () => {
  const actual = await vi.importActual<typeof import("@platform/api/client")>(
    "@platform/api/client",
  );
  return { ...actual, api: { ...actual.api, POST: transport.post } };
});

const me = { user: { platform_role: "admin" } } as AuthMe;

beforeEach(() => vi.clearAllMocks());

test("completed verification clears the password form and leaves restart guidance", async () => {
  transport.post.mockResolvedValue({
    data: { complete: true },
    response: new Response(),
  });
  render(<AccountStorageUpgrade me={me} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("管理员密码"), "test-only-password");
  await user.click(screen.getByRole("button", { name: "迁移并核验文件" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "请关闭并重新启动应用",
  );
  expect(screen.queryByLabelText("管理员密码")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "迁移并核验文件" }),
  ).not.toBeInTheDocument();
  expect(reauthenticate).toHaveBeenCalledWith("test-only-password");
});

test("failed reauthentication keeps a retryable form without submitting files", async () => {
  vi.mocked(reauthenticate).mockRejectedValueOnce(new Error("验证失败"));
  render(<AccountStorageUpgrade me={me} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("管理员密码"), "test-only-password");
  await user.click(screen.getByRole("button", { name: "迁移并核验文件" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("验证失败");
  await waitFor(() =>
    expect(screen.getByLabelText("管理员密码")).toBeEnabled(),
  );
  expect(transport.post).not.toHaveBeenCalled();
});
