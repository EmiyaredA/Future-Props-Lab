import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { RemoteApps } from "@features/cloud-control/RemoteApps";
import type { CloudStatus } from "@features/cloud-control/cloudApi";

const {
  readRemoteApps,
  readInstalledRemoteApps,
  saveRemoteApps,
  reauthenticate,
} = vi.hoisted(() => ({
  readRemoteApps: vi.fn(),
  readInstalledRemoteApps: vi.fn(),
  saveRemoteApps: vi.fn(),
  reauthenticate: vi.fn(),
}));
vi.mock("@features/cloud-control/cloudApi", () => ({
  readRemoteApps,
  readInstalledRemoteApps,
  saveRemoteApps,
}));
vi.mock("@features/accounts", () => ({ reauthenticate }));

const chrome = { id: "chrome", name: "Google Chrome", recommended: true };
const text = { id: "text", name: "文本编辑", recommended: true };
const code = { id: "code", name: "Visual Studio Code", recommended: false };
const status: CloudStatus = {
  enabled: true,
  host_label: "Mac",
  desktop_configured: true,
  desktop_authorized: true,
  local: true,
  unlocked_until: 0,
  idle_minutes: 30,
  idle_revision: 0,
  happier_available: false,
  remote_apps_enabled: true,
};

function show(overrides: Partial<CloudStatus>, unlock = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RemoteApps
        owner="owner"
        paneId="apps"
        status={{ ...status, ...overrides }}
        visible
        titleHost={null}
        onUnlock={unlock}
      />
    </QueryClientProvider>,
  );
}

it("adds a recommended and a searched app from the trusted Mac", async () => {
  readRemoteApps
    .mockResolvedValueOnce({ apps: [] })
    .mockResolvedValue({ apps: [chrome, code] });
  readInstalledRemoteApps.mockResolvedValue({
    apps: [chrome, text, code],
    allowed_ids: [],
    revision: "revision",
  });
  reauthenticate.mockResolvedValue(undefined);
  saveRemoteApps.mockResolvedValue({
    apps: [chrome, text, code],
    allowed_ids: [chrome.id, code.id],
    revision: "saved",
  });
  show({});
  fireEvent.click(screen.getByRole("button", { name: "添加应用" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "添加 Google Chrome" }),
  );
  expect(within(dialog).queryByText(code.name)).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "已安装应用" }));
  fireEvent.change(within(dialog).getByRole("searchbox"), {
    target: { value: "studio code" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "添加 Visual Studio Code" }),
  );
  fireEvent.change(within(dialog).getByLabelText("FPL 管理员密码"), {
    target: { value: "fixture" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存应用名单" }));
  await waitFor(() =>
    expect(saveRemoteApps).toHaveBeenCalledWith({
      revision: "revision",
      app_ids: ["chrome", "code"],
    }),
  );
  expect(reauthenticate).toHaveBeenCalledWith("fixture");
  expect(
    await screen.findByRole("button", { name: chrome.name }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: code.name }));
  expect(screen.getByRole("button", { name: code.name })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("does not expose app discovery or the allowlist to the locked public browser", () => {
  readRemoteApps.mockClear();
  const unlock = vi.fn();
  show({ local: false, desktop_authorized: false }, unlock);
  expect(
    screen.queryByRole("button", { name: "添加应用" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "验证访问权限" }));
  expect(unlock).toHaveBeenCalledOnce();
  expect(readRemoteApps).not.toHaveBeenCalled();
});

it("shows authorized remote users where to add an app without reading the Mac catalog", async () => {
  readRemoteApps.mockResolvedValue({ apps: [] });
  readInstalledRemoteApps.mockClear();
  show({ local: false });
  fireEvent.click(screen.getByRole("button", { name: "添加应用" }));
  const dialog = screen.getByRole("dialog", { name: "添加远程应用" });
  expect(within(dialog).getByText(/请在 Mac 上打开本机/)).toBeVisible();
  expect(within(dialog).queryByLabelText("FPL 管理员密码")).toBeNull();
  expect(readInstalledRemoteApps).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
