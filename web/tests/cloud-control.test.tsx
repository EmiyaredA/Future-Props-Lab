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

const { reauthenticate, unlockCloud, launchHappier } = vi.hoisted(() => ({
  reauthenticate: vi.fn(),
  unlockCloud: vi.fn(),
  launchHappier: vi.fn(),
}));
vi.mock("@features/accounts", async (original) => ({
  ...(await original<typeof import("@features/accounts")>()),
  reauthenticate,
}));
vi.mock("@features/cloud-control/cloudApi", () => ({
  unlockCloud,
  launchHappier,
  readCloudStatus: async () => ({
    enabled: false,
    local: true,
    unlocked_until: 0,
    desktop_configured: false,
    host_label: "Fixture Mac",
  }),
}));

it("retries an unavailable relay and preserves the same frame across cloud view changes", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryDefaults(["cloud-control", "happier-owner", "status"], {
    staleTime: Infinity,
  });
  queryClient.setQueryData(["cloud-control", "happier-owner", "status"], {
    enabled: true,
    local: false,
    desktop_configured: false,
    happier_available: true,
    unlocked_until: Date.now() / 1000 + 120,
    host_label: "Fixture Mac",
  });
  launchHappier.mockResolvedValue({
    exchange_url:
      "https://happier.example.test/v1/cloud-control/happier/exchange",
    ticket: "fixture",
  });
  const exchange = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe(
      "https://happier.example.test/v1/cloud-control/happier/exchange",
    );
    expect(init.credentials).toBe("include");
    expect((init.body as URLSearchParams).get("ticket")).toBe("fixture");
    return exchange.mock.calls.length === 1
      ? { status: 503, ok: false }
      : { ok: true };
  });
  vi.stubGlobal("fetch", exchange);
  try {
    render(
      <QueryClientProvider client={queryClient}>
        <AccountAccessProvider
          userId="happier-owner"
          permissions={["cloud-control.access"]}
        >
          <CloudControlPage owner="happier-owner" hideUnavailableAgent />
        </AccountAccessProvider>
      </QueryClientProvider>,
    );
    expect(exchange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Agent 工作台$/ }));
    await waitFor(() => expect(exchange).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Happier 暂不可用",
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    const frame = await screen.findByTitle("Happier Agent 工作台");
    await waitFor(() =>
      expect(frame).toHaveAttribute(
        "src",
        "https://happier.example.test/?server=https%3A%2F%2Fhappier.example.test",
      ),
    );
    fireEvent.load(frame);
    expect(frame).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^远程桌面$/ }));
    expect(frame).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Agent 工作台$/ }));
    expect(screen.getByTitle("Happier Agent 工作台")).toBe(frame);
    expect(frame).toBeVisible();
    expect(exchange).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    localStorage.removeItem("fpl.cloud-control.view.happier-owner");
  }
});
it("shows the independent Agent tab only when the server offers Happier", async () => {
  const queryClient = new QueryClient();
  const owner = "independent-owner";
  const statusKey = ["cloud-control", owner, "status"];
  queryClient.setQueryDefaults(statusKey, { staleTime: Infinity });
  const status = {
    enabled: true,
    local: true,
    unlocked_until: 0,
    desktop_configured: false,
    host_label: "Fixture Mac",
  };
  queryClient.setQueryData(statusKey, status);
  render(
    <QueryClientProvider client={queryClient}>
      <AccountAccessProvider
        userId={owner}
        permissions={["cloud-control.access"]}
      >
        <CloudControlPage owner={owner} hideUnavailableAgent preferAgent />
      </AccountAccessProvider>
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("button", { name: /^Agent 工作台$/ })).toBeNull();
  const url = "https://studio.fpl.localhost:3443/cloud-control?view=agent";
  queryClient.setQueryData(statusKey, { ...status, happier_studio_url: url });
  expect(
    await screen.findByRole("link", { name: "从 Studio HTTPS 入口登录" }),
  ).toHaveAttribute("href", url);
});

it("switches cloud views and remembers the selection per account", async () => {
  const queryClient = new QueryClient();
  const view = (owner: string) => (
    <QueryClientProvider client={queryClient}>
      <AccountAccessProvider
        userId={owner}
        permissions={["cloud-control.access"]}
      >
        <CloudControlPage owner={owner} />
      </AccountAccessProvider>
    </QueryClientProvider>
  );
  try {
    const { rerender } = render(view("admin"));
    expect(screen.getByRole("heading", { name: /^云控$/ })).toBeVisible();
    expect(screen.getByRole("region", { name: "远程桌面" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Agent 工作台" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Agent 工作台$/ }));
    const agent = screen.getByRole("region", { name: "Agent 工作台" });
    expect(agent).toBeVisible();
    expect(screen.queryByRole("region", { name: "远程桌面" })).toBeNull();
    expect(
      await screen.findByText("此账号或入口尚未启用 Happier。"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^远程桌面$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Agent 工作台$/ }));
    expect(screen.getByRole("region", { name: "Agent 工作台" })).toBe(agent);
    rerender(view("other-admin"));
    expect(screen.getByRole("region", { name: "远程桌面" })).toBeVisible();
    rerender(view("admin"));
    expect(screen.getByRole("region", { name: "Agent 工作台" })).toBeVisible();
  } finally {
    localStorage.removeItem("fpl.cloud-control.view.admin");
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

it("preserves workbench deep links and removes retired tool pages", () => {
  expect(parseRoute("/cloud-control").page).toBe("cloud-control");
  expect(pathFor("cloud-control")).toBe("/cloud-control");
  for (const path of [
    "/agents/sessions/session-one",
    "/apps/agent-workbench/sources",
  ]) {
    expect(parseRoute(path)).toEqual({
      page: "cloud-control",
      search: "?view=agent",
    });
  }
  expect(parseRoute("/tools/storage-usage").page).toBe("tools");
  expect(parseRoute("/tools/codex-model-source").page).toBe("tools");
});

it("verifies the administrator password before requesting an Agent grant", async () => {
  const unlocked = vi.fn();
  reauthenticate.mockRejectedValueOnce(new Error("密码不正确"));
  reauthenticate.mockResolvedValueOnce(undefined);
  unlockCloud.mockResolvedValueOnce(undefined);
  render(<CloudUnlock purpose="agent" close={vi.fn()} unlocked={unlocked} />);

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
  expect(unlockCloud).toHaveBeenCalledExactlyOnceWith("agent");
});
