import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { ManagementAuthGate } from "@app/entries/ManagementAuthGate";
import { useStudioSession } from "@app/StudioSession";

const account = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("@features/accounts/api", () => ({
  getMe: account.getMe,
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));
function identity(id: string) {
  return {
    user: {
      id,
      display_name: id,
      username: id,
      is_platform_admin: true,
      platform_role: "admin",
      revision: 0,
      email: null,
      avatar_url: null,
    },
    must_change_password: false,
    permission_keys: ["configuration.manage"],
    storage_upgrade_required: false,
    session_expires_at: "2099-01-01T00:00:00",
  };
}
function Current() {
  return <div>{useStudioSession().me.user.display_name}</div>;
}
test("management identity changes clear cached private data before rendering the new account", async () => {
  account.getMe.mockResolvedValue(identity("First"));
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <ManagementAuthGate>
        <Current />
      </ManagementAuthGate>
    </QueryClientProvider>,
  );
  await screen.findByText("First");
  cache.setQueryData(["private-catalog"], { owner: "First" });
  account.getMe.mockResolvedValue(identity("Second"));
  fireEvent.focus(window);
  await screen.findByText("Second");
  await waitFor(() =>
    expect(cache.getQueryData(["private-catalog"])).toBeUndefined(),
  );
});
