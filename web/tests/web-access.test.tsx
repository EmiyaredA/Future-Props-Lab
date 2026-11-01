import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, vi } from "vitest";
import WebAccessDialog from "@features/accounts/WebAccessDialog";
import { useVisibleApiBlobUrl } from "@platform/api/useVisibleApiBlobUrl";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  blob: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@platform/api/client", () => ({
  api: { GET: mocks.get, POST: mocks.post, PUT: mocks.put },
  unwrap: async (value: unknown) => value,
  fetchApiBlob: mocks.blob,
}));
vi.mock("@features/accounts/api", () => ({ reauthenticate: mocks.verify }));
const profile = {
  host: "gateway.test",
  user: "fpl-gateway",
  origin: "https://studio.test",
  local_port: 28081,
  remote_port: 28080,
  ssh_port: 22,
  identity_id: "a".repeat(32),
  known_hosts_id: "b".repeat(32),
};
let status = {
  local: {
    phase: "off",
    url: "http://127.0.0.1:28081",
    last_checked_at: "",
    error: "",
  },
  public: { phase: "off", url: profile.origin, last_checked_at: "", error: "" },
  bytes_received: 0,
  bytes_sent: 0,
  requests: 0,
  build_id: "test",
};
beforeEach(() => {
  vi.clearAllMocks();
  status = {
    ...status,
    local: { ...status.local, phase: "off" },
    public: { ...status.public, phase: "off" },
  };
  mocks.get.mockImplementation(async (url: string) =>
    url.endsWith("/config")
      ? {
          revision: "c".repeat(64),
          profile,
          identity_fingerprint: "SHA256:test",
          known_hosts_fingerprint: "SHA256:host",
          legacy_available: false,
        }
      : status,
  );
  mocks.post.mockImplementation(
    async (_url: string, { body }: { body: { action: string } }) => {
      if (body.action === "local_start")
        status = { ...status, local: { ...status.local, phase: "ready" } };
      return status;
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test("access panel exposes independent off states and disables config while running", async () => {
  const close = vi.fn();
  const user = userEvent.setup();
  render(<WebAccessDialog onClose={close} />);
  expect(await screen.findAllByText("已关闭")).toHaveLength(2);
  await user.click(screen.getAllByRole("button", { name: "开启" })[0]);
  expect(await screen.findByText("正常")).toBeVisible();
  await user.click(screen.getByText("网关与连接凭据"));
  expect(screen.getByLabelText("SSH 主机")).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(close).toHaveBeenCalledTimes(1);
});

test("dirty profile keeps the panel open and supports explicit discard", async () => {
  const close = vi.fn();
  const user = userEvent.setup();
  render(<WebAccessDialog onClose={close} />);
  await screen.findAllByText("已关闭");
  await user.click(screen.getByText("网关与连接凭据"));
  await user.clear(screen.getByLabelText("SSH 主机"));
  await user.type(screen.getByLabelText("SSH 主机"), "other.test");
  await user.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText(/连接配置尚未保存/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "放弃更改" }));
  expect(screen.getByLabelText("SSH 主机")).toHaveValue("gateway.test");
});

test("visible previews do not fetch originals or fetch before intersection", async () => {
  let intersect: IntersectionObserverCallback = () => {};
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  mocks.blob.mockResolvedValue(new Blob(["preview"], { type: "image/webp" }));
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  function Preview() {
    const { ref, url } = useVisibleApiBlobUrl(
      "/v1/files/private/thumbnail?size=320",
    );
    return <div ref={ref}>{url}</div>;
  }
  const view = render(<Preview />);
  expect(mocks.blob).not.toHaveBeenCalled();
  act(() =>
    intersect(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  await waitFor(() =>
    expect(mocks.blob).toHaveBeenCalledWith(
      "/v1/files/private/thumbnail?size=320",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  await screen.findByText("blob:preview");
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});
