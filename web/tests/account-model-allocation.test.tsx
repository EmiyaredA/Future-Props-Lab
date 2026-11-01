import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TemplateSyncTarget } from "@features/accounts/TemplateSyncTarget";
import { fetchManagedAccounts } from "@features/accounts/managementApi";
vi.mock("@features/accounts/managementApi", () => ({
  fetchManagedAccounts: vi.fn(),
}));

test("model distribution can select an active account without opening its private catalog", async () => {
  vi.mocked(fetchManagedAccounts).mockResolvedValue({
    items: [
      {
        id: "alice",
        username: "alice",
        display_name: "Alice",
        email: null,
        status: "active",
        is_platform_admin: false,
        platform_role: "user",
        must_change_password: false,
        revision: 0,
        last_login_at: null,
        created_at: "2026-11-01T00:00:00Z",
      },
    ],
    total: 1,
    page: 1,
    page_size: 100,
  });
  const changed = vi.fn(),
    user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TemplateSyncTarget role="user" onChange={changed} />
    </QueryClientProvider>,
  );
  expect(fetchManagedAccounts).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "仅同步指定账号" }));
  expect(changed).toHaveBeenLastCalledWith("");
  await waitFor(() =>
    expect(fetchManagedAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", platform_role: "user" }),
    ),
  );
  await user.click(screen.getByRole("combobox", { name: "同步目标账号" }));
  await user.click(screen.getByRole("option", { name: "Alice · @alice" }));
  expect(changed).toHaveBeenLastCalledWith("alice");
  await user.click(
    screen.getByRole("button", { name: "改为同步该身份全部账号" }),
  );
  expect(changed).toHaveBeenLastCalledWith(null);
});
