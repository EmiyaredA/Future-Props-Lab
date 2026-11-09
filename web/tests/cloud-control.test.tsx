import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";
import { CloudUnlock } from "@features/cloud-control/CloudUnlock";
import { CloudControlPage } from "@features/cloud-control/CloudControlPage";
import { CloudControlAccess } from "@features/cloud-control/CloudControlAccess";
import { APPLICATION_DEFINITIONS } from "@app/applicationRegistry";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplicationCenterPage } from "@features/applications/ApplicationCenterPage";
import { parseRoute, pathFor } from "@app/routes";

const { reauthenticate, unlockCloud } = vi.hoisted(() => ({
  reauthenticate: vi.fn(),
  unlockCloud: vi.fn(),
}));
vi.mock("@features/accounts", async (original) => ({
  ...(await original<typeof import("@features/accounts")>()),
  reauthenticate,
}));
vi.mock("@features/cloud-control/cloudApi", () => ({
  unlockCloud,
  readCloudStatus: async () => ({
    enabled: false,
    local: true,
    unlocked_until: 0,
    desktop_configured: false,
    host_label: "Fixture Mac",
  }),
}));

it("shows desktop only even for accounts with a legacy Happier grant", () => {
  const queryClient = new QueryClient();
  const owner = "happier-owner";
  const key = ["cloud-control", owner, "status"];
  queryClient.setQueryDefaults(key, { staleTime: Infinity });
  queryClient.setQueryData(key, {
    enabled: true,
    local: true,
    desktop_configured: true,
    happier_available: true,
    unlocked_until: Date.now() / 1000 + 120,
    host_label: "Fixture Mac",
  });
  localStorage.setItem(`fpl.cloud-control.view.${owner}`, "agent");
  try {
    render(
      <QueryClientProvider client={queryClient}>
        <AccountAccessProvider
          userId={owner}
          permissions={["cloud-control.access"]}
        >
          <CloudControlPage owner={owner} />
        </AccountAccessProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("region", { name: "远程桌面" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Agent 工作台" })).toBeNull();
    expect(screen.queryByTitle("Happier Agent 工作台")).toBeNull();
  } finally {
    localStorage.removeItem(`fpl.cloud-control.view.${owner}`);
  }
});

it("never mounts protected content without cloud control permission", () => {
  const request = vi.fn();
  function Protected() {
    request();
    return <p>private history</p>;
  }
  const view = (permissions: string[]) => (
    <AccountAccessProvider userId="same-account" permissions={permissions}>
      <CloudControlAccess>
        <Protected />
      </CloudControlAccess>
    </AccountAccessProvider>
  );
  const { rerender } = render(view([]));
  expect(request).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { name: "云控仅限管理员访问" }),
  ).toBeInTheDocument();
  rerender(view(["cloud-control.access"]));
  expect(screen.getByText("private history")).toBeInTheDocument();
  rerender(view([]));
  expect(screen.queryByText("private history")).not.toBeInTheDocument();
});

it("omits the workbench from applications and stale recent entries", () => {
  localStorage.setItem(
    "future-props-recent-applications",
    '["agent-workbench"]',
  );
  render(
    <ApplicationCenterPage
      applications={APPLICATION_DEFINITIONS}
      onOpen={vi.fn()}
    />,
  );
  expect(
    APPLICATION_DEFINITIONS.map((app) => String(app.id)).includes(
      "agent-workbench",
    ),
  ).toBe(false);
  expect(screen.queryByText("Agent 工作台")).not.toBeInTheDocument();
  expect(screen.getByText("还没有访问记录")).toBeInTheDocument();
});

it("routes retired workbench deep links to Amadeus", () => {
  expect(parseRoute("/cloud-control").page).toBe("cloud-control");
  expect(pathFor("cloud-control")).toBe("/cloud-control");
  for (const path of [
    "/agents/sessions/session-one",
    "/apps/agent-workbench/sources",
    "/cloud-control?view=agent",
  ]) {
    expect(parseRoute(path)).toEqual({
      page: "amadeus",
    });
  }
  expect(parseRoute("/tools/storage-usage").page).toBe("tools");
  expect(parseRoute("/tools/codex-model-source").page).toBe("tools");
});

it("verifies the administrator password before requesting a desktop grant", async () => {
  const unlocked = vi.fn();
  reauthenticate.mockRejectedValueOnce(new Error("密码不正确"));
  reauthenticate.mockResolvedValueOnce(undefined);
  unlockCloud.mockResolvedValueOnce(undefined);
  render(<CloudUnlock close={vi.fn()} unlocked={unlocked} />);

  const password = screen.getByLabelText("管理员密码");
  const submit = screen.getByRole("button", { name: /^验证$/ });
  expect(screen.queryByText("动态验证码")).toBeNull();
  fireEvent.change(password, { target: { value: "incorrect" } });
  fireEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent("密码不正确");
  expect(unlockCloud).not.toHaveBeenCalled();

  fireEvent.change(password, { target: { value: "fixture-password" } });
  fireEvent.click(submit);
  await waitFor(() => expect(unlocked).toHaveBeenCalledOnce());
  expect(reauthenticate).toHaveBeenLastCalledWith("fixture-password");
  expect(unlockCloud).toHaveBeenCalledExactlyOnceWith("desktop");
});
