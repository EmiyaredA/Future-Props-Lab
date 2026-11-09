import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Monitor,
  Plus,
  Unplug,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { RemoteAppCatalogDialog } from "./RemoteAppCatalogDialog";
import { RemoteAppSurface } from "./RemoteAppSurface";
import { readRemoteApps, type CloudStatus } from "./cloudApi";
import { useRemoteApp } from "./useRemoteApp";
import "./remote-apps.css";

const statusText = {
  idle: "未连接",
  starting: "正在启动应用",
  waiting: "等待首帧",
  connected: "已连接",
  paused: "等待选择窗口",
};

export function RemoteApps({
  owner,
  paneId,
  status,
  visible,
  titleHost,
  onUnlock,
}: {
  owner: string;
  paneId: string;
  status: CloudStatus;
  visible: boolean;
  titleHost: HTMLElement | null;
  onUnlock: () => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [manager, setManager] = useState(false);
  const [fit, setFit] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const disconnectButton = useRef<HTMLButtonElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const remote = useRemoteApp();
  const queryClient = useQueryClient();
  const key = ["cloud-control", owner, "allowed-apps"] as const;
  const { disconnect } = remote;
  const apps = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readRemoteApps(signal),
    enabled: status.desktop_authorized,
    refetchInterval: 15_000,
  });
  const items = status.desktop_authorized ? (apps.data?.apps ?? []) : [];
  const active = items.find((item) => item.id === selected) ?? items[0];
  const connected = remote.state === "connected";
  const inputReady =
    connected && remote.channelOpen && !remote.hostInputBlocked;
  const connectionText = connected
    ? !remote.channelOpen
      ? "画面已连接，等待键鼠"
      : remote.hostInputBlocked
        ? "画面已连接，键鼠已暂停"
        : statusText.connected
    : statusText[remote.state];
  const starting = remote.state === "starting" || remote.state === "waiting";

  useEffect(() => {
    if (!visible || !status.desktop_authorized) disconnect();
  }, [visible, status.desktop_authorized, disconnect]);

  useEffect(() => {
    if (
      apps.data &&
      selected &&
      !apps.data.apps.some((item) => item.id === selected)
    )
      disconnect();
  }, [apps.data, selected, disconnect]);

  useEffect(() => {
    function syncFullscreen() {
      setIsFullscreen(
        !!viewport.current && document.fullscreenElement === viewport.current,
      );
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    if (
      (!connected || !visible) &&
      viewport.current &&
      document.fullscreenElement === viewport.current
    ) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [connected, visible]);

  function switchApp(id: string) {
    if (id === active?.id) return;
    setSelected(id);
    if (remote.state !== "idle") void remote.connect(id);
  }

  function start() {
    if (!status.desktop_authorized) {
      onUnlock();
    } else if (active) {
      setSelected(active.id);
      void remote.connect(active.id);
    }
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement === viewport.current)
        await document.exitFullscreen();
      else await viewport.current?.requestFullscreen();
      setFullscreenError("");
    } catch {
      setFullscreenError(
        isFullscreen ? "当前浏览器无法退出全屏" : "当前浏览器无法打开全屏",
      );
    }
  }

  const fullscreenLabel = isFullscreen ? "退出全屏" : "全屏";
  const FullscreenIcon = isFullscreen ? Minimize2 : Maximize2;
  const connection = (
    <div className="cloud-app-connection" role="group" aria-label="远控操作">
      <span className="cloud-host" title={status.host_label}>
        {status.host_label}
      </span>
      <span
        className="cloud-connection"
        data-connected={inputReady}
        role="status"
      >
        {connectionText}
      </span>
      {remote.state !== "idle" && (
        <button
          className="btn cloud-app-icon-button"
          ref={disconnectButton}
          type="button"
          aria-label="断开连接"
          title="断开连接"
          onClick={disconnect}
        >
          <Unplug size={15} aria-hidden="true" />
        </button>
      )}
      {remote.windows.length > 0 && (
        <CustomSelect
          className="cloud-app-window-select"
          ariaLabel="远程应用窗口"
          value={String(remote.selected ?? "")}
          options={remote.windows.map((item) => ({
            value: String(item.id),
            label: item.title,
          }))}
          onChange={(value) =>
            active && void remote.connect(active.id, Number(value))
          }
        />
      )}
    </div>
  );

  return (
    <section
      id={paneId}
      className="cloud-pane cloud-app-pane"
      hidden={!visible}
      aria-label="远程应用"
    >
      {visible && titleHost && createPortal(connection, titleHost)}
      {(status.desktop_authorized || status.local) && (
        <div className="cloud-app-tabs">
          <div
            className="cloud-app-tab-list"
            role="group"
            aria-label="可远控的应用"
          >
            {items.map((item) => (
              <button
                className="btn cloud-app-tab"
                type="button"
                key={item.id}
                aria-pressed={item.id === active?.id}
                onClick={() => switchApp(item.id)}
              >
                <AppWindow size={15} aria-hidden="true" /> {item.name}
              </button>
            ))}
          </div>
          <button
            className="btn cloud-app-tab"
            type="button"
            onClick={() => setManager(true)}
          >
            <Plus size={15} aria-hidden="true" /> 添加应用
          </button>
        </div>
      )}
      <div
        className="cloud-viewport cloud-app-viewport"
        ref={viewport}
        data-fit={fit}
        data-frame-ready={connected}
      >
        <RemoteAppSurface
          key={remote.generation}
          video={remote.video}
          inputReady={inputReady}
          fit={fit}
          send={remote.send}
          releaseFocus={() => {
            (isFullscreen
              ? fullscreenButton
              : disconnectButton
            ).current?.focus();
          }}
        />
        {connected && !inputReady && (
          <div className="cloud-app-input-status">
            <span role={isFullscreen ? "status" : undefined}>
              {connectionText}
            </span>
            {remote.channelOpen && remote.hostInputBlocked && active && (
              <button
                className="btn cloud-app-refocus"
                type="button"
                title="将所选窗口切回 Mac 前台并恢复远程键鼠"
                onClick={() => void remote.connect(active.id, remote.selected)}
              >
                恢复键鼠
              </button>
            )}
          </div>
        )}
        {connected && (
          <div
            className="cloud-app-viewport-tools"
            role="group"
            aria-label="画面操作"
          >
            <button
              className="btn cloud-app-icon-button"
              type="button"
              aria-label="适应窗口"
              title="适应窗口"
              aria-pressed={fit}
              onClick={() => setFit((value) => !value)}
            >
              <Monitor size={16} aria-hidden="true" />
            </button>
            <button
              className="btn cloud-app-icon-button"
              ref={fullscreenButton}
              type="button"
              aria-label={fullscreenLabel}
              title={fullscreenLabel}
              onClick={() => void fullscreen()}
            >
              <FullscreenIcon size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {!connected && (
          <div className="cloud-desktop-empty">
            {starting ? (
              <LoaderCircle
                className="cloud-frame-spinner"
                aria-hidden="true"
              />
            ) : (
              <AppWindow size={36} aria-hidden="true" />
            )}
            <strong>{active?.name ?? "远程应用"}</strong>
            {(remote.error || apps.error || fullscreenError) && (
              <p role="alert">
                {remote.error || apps.error?.message || fullscreenError}
              </p>
            )}
            {starting ? (
              <button className="btn" type="button" onClick={disconnect}>
                取消连接
              </button>
            ) : remote.state === "paused" && remote.windows.length ? (
              <p>请从页头选择其他窗口。</p>
            ) : !status.desktop_authorized && status.desktop_configured ? (
              <button
                className="btn cloud-primary"
                type="button"
                onClick={start}
              >
                验证访问权限
              </button>
            ) : active ? (
              <button
                className="btn cloud-primary"
                type="button"
                onClick={start}
              >
                {remote.error ? "重新连接" : "连接应用"}
              </button>
            ) : (
              <p>
                {apps.isFetching ? "正在读取允许的应用…" : "暂无可远控的应用"}
              </p>
            )}
          </div>
        )}
      </div>
      {fullscreenError && connected && (
        <p className="cloud-app-fullscreen-error" role="alert">
          {fullscreenError}
        </p>
      )}
      {visible && manager && (status.desktop_authorized || status.local) && (
        <RemoteAppCatalogDialog
          owner={owner}
          local={status.local}
          changed={(catalog) => {
            const installed = new Map(
              catalog.apps.map((item) => [item.id, item]),
            );
            const approved = catalog.allowed_ids.flatMap((id) => {
              const item = installed.get(id);
              return item ? [item] : [];
            });
            void queryClient.cancelQueries({ queryKey: key });
            queryClient.setQueryData(key, { apps: approved });
          }}
          close={() => setManager(false)}
        />
      )}
    </section>
  );
}
