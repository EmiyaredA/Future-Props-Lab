import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { RemoteApps } from "@features/cloud-control/RemoteApps";

const { connectRemoteApp } = vi.hoisted(() => ({ connectRemoteApp: vi.fn() }));
vi.mock("@features/cloud-control/cloudApi", () => ({
  connectRemoteApp,
  readRemoteApps: async () => ({
    apps: [
      { id: "chrome", name: "Chrome", recommended: true },
      { id: "text", name: "TextEdit", recommended: true },
    ],
  }),
}));

class SignalSocket {
  static instances: SignalSocket[] = [];
  static OPEN = 1;
  readyState = SignalSocket.OPEN;
  onopen?: () => Promise<void>;
  onmessage?: (event: { data: string }) => Promise<void>;
  send = vi.fn();
  close = vi.fn();

  constructor() {
    SignalSocket.instances.push(this);
  }

  message(data: object) {
    return this.onmessage?.({ data: JSON.stringify(data) });
  }
}

class Peer {
  static instances: Peer[] = [];
  iceGatheringState = "complete";
  localDescription = { sdp: "v=0" };
  addTransceiver = vi.fn(() => ({ receiver: { jitterBufferTarget: null } }));
  createDataChannel = vi.fn(() => ({}));
  createOffer = vi.fn();
  setLocalDescription = vi.fn();
  setRemoteDescription = vi.fn();
  close = vi.fn();

  constructor() {
    Peer.instances.push(this);
  }
}

it("abandons the first connection and its callbacks when a different app is selected", async () => {
  vi.stubGlobal("WebSocket", SignalSocket);
  vi.stubGlobal("RTCPeerConnection", Peer);
  connectRemoteApp.mockResolvedValue({ ticket: "one-time", ice_servers: [] });
  const client = new QueryClient();
  try {
    render(
      <QueryClientProvider client={client}>
        <RemoteApps
          owner="fixture"
          paneId="apps"
          visible
          onUnlock={vi.fn()}
          onChange={vi.fn()}
          status={{
            enabled: true,
            local: true,
            host_label: "Mac",
            desktop_configured: true,
            desktop_authorized: true,
            unlocked_until: 0,
            idle_minutes: 30,
            idle_revision: 0,
            happier_available: false,
            remote_apps_enabled: true,
          }}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "连接应用" }));
    await waitFor(() => expect(SignalSocket.instances).toHaveLength(1));
    const original = SignalSocket.instances[0];
    await act(async () => {
      await original.onopen?.();
      await original.message({
        type: "windows",
        windows: [{ id: 1, title: "Chrome window" }],
      });
    });
    expect(original.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "select", window: 1 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "TextEdit" }));
    await waitFor(() => expect(SignalSocket.instances).toHaveLength(2));
    expect(original.close).toHaveBeenCalledOnce();
    expect(Peer.instances[0].close).toHaveBeenCalledOnce();
    expect(connectRemoteApp.mock.calls.map(([app]) => app)).toEqual([
      "chrome",
      "text",
    ]);
    await act(async () => {
      await original.message({
        type: "error",
        message: "late failure from old connection",
      });
    });
    expect(
      screen.queryByText("late failure from old connection"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在启动应用");
  } finally {
    vi.unstubAllGlobals();
  }
});
