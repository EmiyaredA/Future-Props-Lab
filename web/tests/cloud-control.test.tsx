import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";
import { CloudControlPage } from "@features/cloud-control/CloudControlPage";
import { CloudControlAccess } from "@features/cloud-control/CloudControlAccess";
import { APPLICATION_DEFINITIONS } from "@app/applicationRegistry";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplicationCenterPage } from "@features/applications/ApplicationCenterPage";
import { parseRoute, pathFor } from "@app/routes";

vi.mock("@features/cloud-control/cloudApi", () => ({
  readCloudStatus: async () => ({
    enabled: false,
    local: true,
    enrolled: false,
    unlocked_until: 0,
    desktop_configured: false,
    host_label: "Fixture Mac",
  }),
}));
vi.mock("@features/agent-workbench/executionApi", () => ({
  getChats: async () => [],
}));
vi.mock("@features/agent-workbench/api", async (original) => ({
  ...(await original<typeof import("@features/agent-workbench/api")>()),
  getSessions: async () => ({ items: [] }),
}));

it("offers the two cloud panes and preserves the full workbench entry", async () => {
  const open = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = observe;
      disconnect() {}
    },
  );
  try {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AccountAccessProvider
          userId="admin"
          permissions={["cloud-control.access"]}
        >
          <CloudControlPage
            owner="admin"
            onHistory={open}
            onSources={vi.fn()}
          />
        </AccountAccessProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: /^云控$/ })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "远程桌面" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Agent 工作台" }),
    ).toBeInTheDocument();
    const divider = screen.getByRole("separator", { name: "调整远程桌面宽度" });
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "63");
    fireEvent.click(screen.getByRole("button", { name: "会话历史" }));
    fireEvent.click(screen.getByRole("button", { name: "查看完整工作台" }));
    expect(open).toHaveBeenCalledWith();
    expect(screen.queryByText("空间占用")).not.toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
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
  expect(parseRoute("/agents/sessions/session-one")).toMatchObject({
    page: "agent-workbench-session",
    projectId: "session-one",
  });
  expect(parseRoute("/apps/agent-workbench/sources").page).toBe(
    "agent-workbench-sources",
  );
  expect(pathFor("agent-workbench-session", "session-one")).toBe(
    "/agents/sessions/session-one",
  );
  expect(parseRoute("/tools/storage-usage").page).toBe("tools");
  expect(parseRoute("/tools/codex-model-source").page).toBe("tools");
});
