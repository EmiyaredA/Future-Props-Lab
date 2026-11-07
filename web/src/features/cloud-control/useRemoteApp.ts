import { useCallback, useEffect, useRef, useState } from "react";
import { connectRemoteApp } from "./cloudApi";

export type RemoteWindow = { id: number; title: string };
type State = "idle" | "starting" | "waiting" | "connected" | "paused";

type HostMessage =
  | { type: "windows"; windows: RemoteWindow[] }
  | { type: "answer"; sdp: string }
  | { type: "error" | "paused"; message: string }
  | { type: "waiting" };

async function gather(peer: RTCPeerConnection, signal: AbortSignal) {
  if (peer.iceGatheringState === "complete" || signal.aborted) return;
  await new Promise<void>((resolve) => {
    function finish() {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", changed);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    function changed() {
      if (peer.iceGatheringState === "complete") finish();
    }
    const timeout = window.setTimeout(finish, 8000);
    peer.addEventListener("icegatheringstatechange", changed);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function useRemoteApp() {
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<RTCDataChannel | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [state, setState] = useState<State>("idle");
  const [windows, setWindows] = useState<RemoteWindow[]>([]);
  const [selected, setSelected] = useState<number>();
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const disconnect = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
    setState("idle");
    setWindows([]);
    setSelected(undefined);
  }, []);

  useEffect(() => () => cleanup.current?.(), []);

  function send(event: object, allowDrop = false) {
    const channel = input.current;
    if (channel?.readyState !== "open") return;
    if (allowDrop && channel.bufferedAmount > 1024) return;
    if (channel.bufferedAmount > 32_768) {
      disconnect();
      setError("远程输入延迟过高，连接已断开");
      return;
    }
    channel.send(JSON.stringify(event));
  }

  async function connect(app: string, targetWindow?: number) {
    disconnect();
    setGeneration((value) => value + 1);
    setState("starting");
    setError("");
    const request = new AbortController();
    const signal = request.signal;
    let peer: RTCPeerConnection | undefined;
    let socket: WebSocket | undefined;
    let surface: HTMLVideoElement | null;
    let firstFrame: number | undefined;
    let waitingFor: number | undefined;
    let offered = false;
    let selectionSent = false;
    const timeout = window.setTimeout(
      () => fail("等待应用画面超时，请重新连接"),
      32_000,
    );

    function clearSurface() {
      if (firstFrame !== undefined)
        surface?.cancelVideoFrameCallback?.(firstFrame);
      if (surface) surface.srcObject = null;
    }
    function fail(message: string) {
      if (signal.aborted) return;
      disconnect();
      setError(message);
    }
    cleanup.current = () => {
      request.abort();
      window.clearTimeout(timeout);
      clearSurface();
      input.current = null;
      peer?.close();
      socket?.close();
    };

    function selectIfReady() {
      if (!offered || waitingFor === undefined || selectionSent) return;
      if (socket?.readyState !== WebSocket.OPEN) return;
      selectionSent = true;
      socket.send(JSON.stringify({ type: "select", window: waitingFor }));
      setSelected(waitingFor);
      setState("waiting");
    }

    try {
      const handshake = await connectRemoteApp(app, signal);
      if (signal.aborted) return;
      const connection = new RTCPeerConnection({
        iceServers: handshake.ice_servers,
      });
      peer = connection;
      const { receiver } = connection.addTransceiver("video", {
        direction: "recvonly",
      });
      if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = 0;
      input.current = connection.createDataChannel("input");
      connection.onconnectionstatechange = () => {
        if (["failed", "disconnected"].includes(connection.connectionState))
          fail("媒体连接已断开，请检查网络后重新连接");
      };
      connection.ontrack = ({ track }) => {
        if (signal.aborted || !video.current) return;
        surface = video.current;
        surface.srcObject = new MediaStream([track]);
        const visible = () => {
          if (signal.aborted || !surface?.srcObject) return;
          window.clearTimeout(timeout);
          setState("connected");
        };
        if (surface.requestVideoFrameCallback)
          firstFrame = surface.requestVideoFrameCallback(visible);
        else
          surface.addEventListener("playing", visible, { once: true, signal });
        void surface.play().catch(() => fail("浏览器无法播放远程应用画面"));
      };
      const endpoint = new URL(
        "/v1/cloud-control/apps/socket",
        window.location.href,
      );
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      const transport = new WebSocket(endpoint, "fpl-remote-app-v1");
      socket = transport;
      transport.onclose = (event) =>
        fail(event.reason || "远程应用已断开，请重新连接");
      transport.onopen = async () => {
        try {
          transport.send(JSON.stringify({ ticket: handshake.ticket }));
          await connection.setLocalDescription(await connection.createOffer());
          await gather(connection, signal);
          if (signal.aborted) return;
          transport.send(
            JSON.stringify({
              type: "offer",
              sdp: connection.localDescription?.sdp,
            }),
          );
          offered = true;
          selectIfReady();
        } catch {
          fail("无法建立 WebRTC 连接");
        }
      };
      transport.onmessage = async ({ data }) => {
        if (signal.aborted) return;
        try {
          const message: HostMessage = JSON.parse(data);
          switch (message.type) {
            case "windows": {
              setWindows(message.windows);
              if (selectionSent || !message.windows.length) break;
              const desired =
                targetWindow === undefined
                  ? message.windows[0]
                  : message.windows.find((item) => item.id === targetWindow);
              if (!desired) {
                window.clearTimeout(timeout);
                setState("paused");
                setError("所选窗口已关闭，请重新选择窗口");
                break;
              }
              waitingFor = desired.id;
              selectIfReady();
              break;
            }
            case "answer":
              await connection.setRemoteDescription({
                type: "answer",
                sdp: message.sdp,
              });
              break;
            case "paused":
              window.clearTimeout(timeout);
              clearSurface();
              setSelected(undefined);
              setState("paused");
              setError(message.message);
              break;
            case "error":
              fail(message.message);
              break;
            case "waiting":
              break;
          }
        } catch {
          fail("无法读取远程应用连接信息");
        }
      };
    } catch (failure) {
      fail(failure instanceof Error ? failure.message : "连接远程应用失败");
    }
  }

  return {
    video,
    state,
    error,
    windows,
    selected,
    generation,
    connect,
    disconnect,
    send,
  };
}
