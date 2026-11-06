import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AppWindow,
  LoaderCircle,
  Maximize,
  Plus,
  Scan,
  Timer,
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
  onUnlock,
  onChange,
}: {
  owner: string;
  paneId: string;
  status: CloudStatus;
  visible: boolean;
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
  const { disconnect } = remote;
  const apps = useQuery({
    queryKey: ["cloud-control", owner, "allowed-apps"],
    queryFn: ({ signal }) => readRemoteApps(signal),
    enabled: status.desktop_authorized,
    refetchInterval: 15_000,
  });
  const items = status.desktop_authorized ? (apps.data?.apps ?? []) : [];
  const active = items.find((item) => item.id === selected) ?? items[0];
  const connected = remote.state === "connected";
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

  return (
    <section
      id={paneId}
      className="cloud-pane cloud-app-pane"
      hidden={!visible}
      aria-label="远程应用"
    >
      <header className="cloud-pane-bar">
        <h2>
          <AppWindow size={19} aria-hidden="true" /> 远程应用
        </h2>
        <span className="cloud-host">{status.host_label}</span>
        <span
          className="cloud-connection"
          data-connected={connected}
          role="status"
        >
          {statusText[remote.state]}
        </span>
        <div className="cloud-pane-actions">
          <button
            className="btn"
            type="button"
            aria-pressed={fit}
            onClick={() => setFit(!fit)}
            disabled={!connected}
          >
            <Scan size={15} aria-hidden="true" /> 适应窗口
          </button>
          <button
            className="btn"
            type="button"
            disabled={!connected}
            onClick={() => void fullscreen()}
          >
            <Maximize size={15} aria-hidden="true" /> 全屏
          </button>
          <div className="cloud-idle-anchor">
            <button
              className="btn"
              type="button"
              aria-expanded={idleOpen}
              onClick={() => setIdleOpen(!idleOpen)}
            >
              <Timer size={15} aria-hidden="true" /> 自动锁定 ·{" "}
              {status.idle_minutes} 分钟
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
        </div>
      </header>
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
        {status.local && (
          <button
            className="btn"
            type="button"
            onClick={() => setManager(true)}
          >
            <Plus size={15} aria-hidden="true" /> 添加应用
          </button>
        )}
      </div>
      <div
        className="cloud-viewport cloud-app-viewport"
        ref={viewport}
        data-fit={fit}
        data-frame-ready={connected}
      >
        <RemoteAppSurface
          key={remote.generation}
          video={remote.video}
          connected={connected}
          fit={fit}
          send={remote.send}
          releaseFocus={() => disconnectButton.current?.focus()}
        />
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
              <p>请从下方选择其他窗口。</p>
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
      <footer className="cloud-pane-footer">
        {remote.windows.length > 0 && (
          <CustomSelect
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
        {connected && <span>点击画面接管键鼠 · Shift + Esc 释放焦点</span>}
        {fullscreenError && connected && <p role="alert">{fullscreenError}</p>}
        {remote.state !== "idle" && (
          <button
            className="btn cloud-app-disconnect"
            ref={disconnectButton}
            type="button"
            onClick={disconnect}
          >
            断开连接
          </button>
        )}
      </footer>
      {manager && (
        <RemoteAppCatalogDialog
          owner={owner}
          changed={() => void apps.refetch()}
          close={() => setManager(false)}
        />
      )}
    </section>
  );
}
