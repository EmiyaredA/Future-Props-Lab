import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  LoaderCircle,
  Maximize,
  Plus,
  Scan,
  Timer,
  Unplug,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { DesktopIdle } from "./DesktopDialogs";
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
  toolbarHost,
  onUnlock,
  onChange,
}: {
  owner: string;
  paneId: string;
  status: CloudStatus;
  visible: boolean;
  toolbarHost?: HTMLElement | null;
  onUnlock: () => void;
  onChange: () => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [manager, setManager] = useState(false);
  const [idleOpen, setIdleOpen] = useState(false);
  const [fit, setFit] = useState(true);
  const [fullscreenError, setFullscreenError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const disconnectButton = useRef<HTMLButtonElement>(null);
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
      setFullscreenError("当前浏览器无法打开全屏");
    }
  }

  const toolbar = (
    <div className="cloud-app-toolbar" role="group" aria-label="远控操作">
      <div className="cloud-app-toolbar-apps">
        <span className="cloud-host">{status.host_label}</span>
        <span
          className="cloud-connection"
          data-connected={inputReady}
          role="status"
        >
          {connectionText}
        </span>
        <div className="cloud-app-tabs">
          <div
            className="cloud-app-tab-list"
            role="group"
            aria-label="可远控的应用"
          >
            {items.map((item) => (
              <button
                className="btn"
                type="button"
                key={item.id}
                aria-pressed={item.id === active?.id}
                onClick={() => switchApp(item.id)}
              >
                <AppWindow size={15} aria-hidden="true" /> {item.name}
              </button>
            ))}
          </div>
          {(status.desktop_authorized || status.local) && (
            <button
              className="btn"
              type="button"
              onClick={() => setManager(true)}
            >
              <Plus size={15} aria-hidden="true" /> 添加应用
            </button>
          )}
        </div>
      </div>
      <div className="cloud-pane-actions cloud-app-toolbar-actions">
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
        <button
          className="btn cloud-app-icon-button"
          type="button"
          aria-label="适应窗口"
          title="适应窗口"
          aria-pressed={fit}
          onClick={() => setFit(!fit)}
          disabled={!connected}
        >
          <Scan size={15} aria-hidden="true" />
        </button>
        <button
          className="btn cloud-app-icon-button"
          type="button"
          aria-label="全屏"
          title="全屏"
          disabled={!connected}
          onClick={() => void fullscreen()}
        >
          <Maximize size={15} aria-hidden="true" />
        </button>
        <div className="cloud-idle-anchor">
          <button
            className="btn cloud-idle-trigger"
            type="button"
            aria-label={`自动锁定 · ${status.idle_minutes} 分钟`}
            title="自动锁定"
            aria-expanded={idleOpen}
            onClick={() => setIdleOpen(!idleOpen)}
          >
            <Timer size={15} aria-hidden="true" /> {status.idle_minutes} 分钟
          </button>
          {idleOpen && (
            <DesktopIdle
              remoteApps
              minutes={status.idle_minutes}
              revision={status.idle_revision}
              changed={onChange}
              close={() => setIdleOpen(false)}
            />
          )}
        </div>
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
      </div>
    </div>
  );

  return (
    <section
      id={paneId}
      className="cloud-pane cloud-app-pane"
      hidden={!visible}
      aria-label="远程应用"
    >
      {visible &&
        (toolbarHost
          ? createPortal(toolbar, toolbarHost)
          : toolbarHost === undefined && toolbar)}
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
          releaseFocus={() => disconnectButton.current?.focus()}
        />
        {connected && !inputReady && (
          <div className="cloud-app-input-status">
            <span>{connectionText}</span>
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
      {fullscreenError && connected && <p role="alert">{fullscreenError}</p>}
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
