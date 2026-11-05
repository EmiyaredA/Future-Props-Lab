import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  LoaderCircle,
  Maximize,
  Monitor,
  Scan,
  Timer,
} from "lucide-react";
import type {
  Client as GuacClient,
  Display,
} from "@glokon/guacamole-common-js";
import { requestDesktop, type CloudStatus } from "./cloudApi";
import { DesktopIdle, DesktopPassword } from "./DesktopDialogs";

const DESKTOP_START_TIMEOUT_MS = 25_000;
const PUBLIC_FRAME_DEADLINE_MS = 90_000;
const IMAGE_DATA = new Set(["blob", "png", "jpeg", "webp"]);

function hasDesktopPixels(display: Display, sample: CanvasRenderingContext2D) {
  const width = display.getWidth();
  const height = display.getHeight();
  if (!width || !height) return false;
  const size = sample.canvas.width;
  sample.clearRect(0, 0, size, size);
  // A resized canvas is transparent. An opaque black desktop is a valid frame.
  sample.drawImage(
    display.getDefaultLayer().getCanvas(),
    0,
    0,
    width,
    height,
    0,
    0,
    size,
    size,
  );
  return sample
    .getImageData(0, 0, size, size)
    .data.some((value, index) => index % 4 === 3 && value > 0);
}

export function RemoteDesktop({
  status,
  visible,
  onUnlock,
  onSetup,
  onChange,
}: {
  status?: CloudStatus;
  visible: boolean;
  onUnlock: () => void;
  onSetup: () => void;
  onChange: () => void;
}) {
  const pane = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const disconnectButton = useRef<HTMLButtonElement>(null);
  const idleButton = useRef<HTMLButtonElement>(null);
  const client = useRef<GuacClient | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const connection = useRef(0);
  const releaseInputs = useRef<(() => void) | null>(null);
  const [state, setState] = useState<
    "idle" | "connecting" | "waiting" | "connected"
  >("idle");
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [focusPassword, setFocusPassword] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [idleOpen, setIdleOpen] = useState(false);
  const minutes = status?.idle_minutes ?? 30;
  const starting = state === "connecting" || state === "waiting";

  useEffect(() => {
    if (!visible) releaseInputs.current?.();
  }, [visible]);

  useEffect(
    () => () => {
      connection.current += 1;
      cleanup.current?.();
    },
    [],
  );

  function disconnect() {
    connection.current += 1;
    cleanup.current?.();
    cleanup.current = null;
    setState("idle");
    setResolution("");
  }

  function fit() {
    const display = client.current?.getDisplay();
    const area = viewport.current;
    if (
      !display?.getWidth() ||
      !display.getHeight() ||
      !area?.clientWidth ||
      !area.clientHeight
    )
      return;
    display.scale(
      Math.min(
        area.clientWidth / display.getWidth(),
        area.clientHeight / display.getHeight(),
      ),
    );
  }

  function openPassword() {
    setPasswordOpen(true);
    setFocusPassword(true);
    setError("");
    if (!status?.desktop_authorized) onUnlock();
  }

  async function connect(password: string) {
    const version = ++connection.current;
    const request = new AbortController();
    let waitingForFrame = false;
    let ready = false;
    const started = performance.now();
    let lastImageData = started;
    const publicDesktop = status?.local === false;
    setState("connecting");
    setError("");
    const checkStarting = () => {
      if (version !== connection.current) return;
      const remaining =
        Math.min(
          lastImageData + DESKTOP_START_TIMEOUT_MS,
          started + PUBLIC_FRAME_DEADLINE_MS,
        ) - performance.now();
      if (publicDesktop && remaining > 0) {
        timeout = window.setTimeout(checkStarting, remaining);
        return;
      }
      disconnect();
      setPasswordOpen(false);
      setError(
        waitingForFrame
          ? publicDesktop
            ? "等待公网桌面画面超时，请重新连接。"
            : "等待桌面画面超时。请确认 Mac 已唤醒且屏幕共享仍开启，再重试。"
          : "连接 Mac 超时。请检查网络与屏幕共享服务，再重试。",
      );
    };
    let timeout = window.setTimeout(checkStarting, DESKTOP_START_TIMEOUT_MS);
    const stopStarting = () => {
      window.clearTimeout(timeout);
      request.abort();
    };
    cleanup.current = stopStarting;
    try {
      const { Client, Keyboard, Mouse, Tunnel, WebSocketTunnel } =
        await import("@glokon/guacamole-common-js");
      if (version !== connection.current) return;
      await requestDesktop(password, request.signal);
      const area = viewport.current;
      if (!area || version !== connection.current) return;
      const endpoint = new URL(
        "/v1/cloud-control/desktop/socket",
        window.location.href,
      );
      endpoint.protocol =
        window.location.protocol === "https:" ? "wss:" : "ws:";
      const tunnel = new WebSocketTunnel(endpoint.href);
      const remote = new Client(tunnel);
      if (publicDesktop) {
        const onInstruction = tunnel.oninstruction;
        tunnel.oninstruction = (opcode, parameters) => {
          if (!ready && IMAGE_DATA.has(opcode))
            lastImageData = performance.now();
          onInstruction?.(opcode, parameters);
        };
      }
      client.current = remote;
      const display = remote.getDisplay();
      const preview = document.createElement("canvas");
      preview.width = preview.height = 16;
      const sample = preview.getContext("2d", { willReadFrequently: true });
      const surface = display.getElement();
      surface.classList.add("cloud-remote-surface");
      const keyboardInput = document.createElement("textarea");
      keyboardInput.className = "cloud-remote-keyboard";
      keyboardInput.setAttribute(
        "aria-label",
        "Mac 远程键盘。按 Shift 加 Escape 释放焦点。",
      );
      keyboardInput.setAttribute("autocomplete", "off");
      area.append(surface, keyboardInput);
      keyboardInput.addEventListener(
        "keydown",
        (event) => {
          if (event.shiftKey && event.key === "Escape") {
            event.preventDefault();
            event.stopImmediatePropagation();
            disconnectButton.current?.focus();
          }
        },
        true,
      );
      const keyboard = new Keyboard(keyboardInput);
      const mouse = new Mouse(surface);
      const touch = new Mouse.Touchscreen(surface);
      const clearInput = (event: Event) => {
        if (event instanceof InputEvent && event.isComposing) return;
        keyboardInput.value = "";
      };
      keyboardInput.addEventListener("input", clearInput);
      keyboardInput.addEventListener("compositionend", clearInput);
      surface.addEventListener("mousedown", (event) => {
        // The native mouse focus action runs after pointerdown and would blur
        // the keyboard input that we focused for the remote session.
        event.preventDefault();
      });
      let controlling = false;
      for (const device of [mouse, touch]) {
        device.onEach(["mousedown", "mouseup", "mousemove"], (event) => {
          if (controlling && "state" in event)
            remote.sendMouseState(
              event.state as InstanceType<typeof Mouse.State>,
              true,
            );
        });
      }
      keyboard.onkeydown = (key) => {
        if (!controlling) return true;
        remote.sendKeyEvent(1, key);
        return false;
      };
      keyboard.onkeyup = (key) => {
        if (controlling) remote.sendKeyEvent(0, key);
      };
      const focus = () => {
        keyboardInput.focus({ preventScroll: true });
        // The window may have lost and regained focus without changing its
        // active element, in which case focus() will not fire a focus event.
        if (!controlling && document.activeElement === keyboardInput) capture();
      };
      const capture = () => {
        if (!ready) return;
        controlling = true;
        setKeyboardActive(true);
      };
      keyboardInput.addEventListener("focus", capture);
      const release = () => {
        if (!controlling) return;
        controlling = false;
        setKeyboardActive(false);
        keyboardInput.value = "";
        tunnel.sendMessage("fpl_release");
        keyboard.reset();
        mouse.reset();
        touch.reset();
      };
      releaseInputs.current = release;
      surface.addEventListener("pointerdown", focus);
      keyboardInput.addEventListener("blur", release);
      window.addEventListener("blur", release);
      const observer = new ResizeObserver(fit);
      observer.observe(area);
      display.onresize = (width, height) => {
        if (ready) setResolution(`${width} × ${height}`);
        fit();
      };
      cleanup.current = () => {
        stopStarting();
        tunnel.onstatechange = null;
        remote.onerror = null;
        remote.onstatechange = null;
        remote.onsync = null;
        display.onresize = null;
        display.cancel();
        release();
        observer.disconnect();
        window.removeEventListener("blur", release);
        remote.disconnect();
        surface.remove();
        keyboardInput.remove();
        client.current = null;
        releaseInputs.current = null;
      };
      const connectionClosed = () => {
        if (version !== connection.current) return;
        disconnect();
        setPasswordOpen(false);
        setError(
          ready
            ? "远程桌面已断开，请重新连接。"
            : "远程桌面连接在画面显示前中断，请重新连接。",
        );
      };
      tunnel.onstatechange = (next) => {
        if (next === Tunnel.State.CLOSED) connectionClosed();
      };
      remote.onstatechange = (next) => {
        if (next === Client.State.CONNECTED) {
          waitingForFrame = true;
          setState("waiting");
        }
        if (next === Client.State.DISCONNECTED) connectionClosed();
      };
      remote.onsync = () => {
        // Guacamole marks the connection open before its asynchronous image tasks finish.
        display.flush(() => {
          if (
            ready ||
            version !== connection.current ||
            !sample ||
            !hasDesktopPixels(display, sample)
          )
            return;
          ready = true;
          window.clearTimeout(timeout);
          remote.onsync = null;
          setResolution(`${display.getWidth()} × ${display.getHeight()}`);
          setState("connected");
          setLocked(false);
          setPasswordOpen(false);
        });
      };
      remote.onerror = (failure) => {
        if (version !== connection.current) return;
        const desktopFocused = !!pane.current?.contains(document.activeElement);
        disconnect();
        if (failure.message === "desktop_idle_timeout") {
          setLocked(true);
          setError("");
          setFocusPassword(desktopFocused);
          setPasswordOpen(true);
          return;
        }
        const messages: Record<string, string> = {
          desktop_password_invalid: "Mac 拒绝了 VNC 密码，请重新输入。",
          desktop_authorization_required: "云控访问验证已失效，请重新验证。",
          desktop_busy: "另一个浏览器正在控制这台 Mac。",
          desktop_unavailable: ready
            ? "Mac 屏幕共享已断开，请重新连接。"
            : waitingForFrame
              ? "远程桌面在画面显示前断开。请确认 Mac 已唤醒，再重试。"
              : "无法连接 Mac 屏幕共享。请检查 Mac 上的屏幕共享服务。",
        };
        setError(
          messages[failure.message ?? ""] ??
            "连接失败，请检查 guacd、Mac 屏幕共享和 VNC 密码。",
        );
        setFocusPassword(desktopFocused);
        setPasswordOpen(failure.message === "desktop_password_invalid");
        onChange();
      };
      remote.connect("");
    } catch (failure) {
      if (version !== connection.current) return;
      disconnect();
      setPasswordOpen(false);
      setError(failure instanceof Error ? failure.message : "连接失败");
      onChange();
    }
  }

  return (
    <section
      className="cloud-pane cloud-remote"
      ref={pane}
      aria-label="远程桌面"
    >
      <header className="cloud-pane-bar">
        <h2>
          <Monitor size={18} />
          远程桌面
        </h2>
        <span className="cloud-host">{status?.host_label ?? "Mac"}</span>
        <span
          className="cloud-connection"
          data-connected={state === "connected"}
        >
          {state === "connected"
            ? "已连接"
            : state === "waiting"
              ? "等待画面"
              : state === "connecting"
                ? "连接中"
                : locked
                  ? "已锁定"
                  : "未连接"}
        </span>
        <div className="cloud-pane-actions">
          <button
            className="btn"
            disabled={state !== "connected"}
            onClick={fit}
          >
            <Scan size={15} />
            适应窗口
          </button>
          <button
            className="btn"
            disabled={state !== "connected"}
            onClick={() => {
              const action = document.fullscreenElement
                ? document.exitFullscreen()
                : pane.current?.requestFullscreen();
              void action?.catch(() => setError("当前浏览器无法打开全屏。"));
            }}
          >
            <Maximize size={15} />
            全屏
          </button>
          <div className="cloud-idle-anchor">
            <button
              ref={idleButton}
              className="btn cloud-idle-trigger"
              aria-expanded={idleOpen}
              aria-haspopup="dialog"
              disabled={!status?.desktop_configured}
              onClick={() => setIdleOpen(!idleOpen)}
            >
              <Timer size={15} aria-hidden="true" />
              自动锁定 · {minutes} 分钟
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {idleOpen && status && (
              <DesktopIdle
                minutes={minutes}
                revision={status.idle_revision}
                changed={onChange}
                close={() => {
                  setIdleOpen(false);
                  if (visible) idleButton.current?.focus();
                }}
              />
            )}
          </div>
        </div>
      </header>
      <div
        className="cloud-viewport"
        data-frame-ready={state === "connected"}
        ref={viewport}
      >
        {state === "idle" && passwordOpen && status?.desktop_authorized ? (
          <DesktopPassword
            locked={locked}
            minutes={minutes}
            focus={focusPassword}
            error={error}
            submit={(password) => void connect(password)}
            close={() => {
              setPasswordOpen(false);
              setError("");
            }}
          />
        ) : (
          state !== "connected" && (
            <div className="cloud-desktop-empty">
              {starting ? (
                <LoaderCircle
                  className="cloud-frame-spinner"
                  size={32}
                  aria-hidden="true"
                />
              ) : (
                <Monitor size={40} strokeWidth={1.3} aria-hidden="true" />
              )}
              <strong>{status?.host_label ?? "Mac"}</strong>
              <p role="status">
                {error ||
                  (!status
                    ? "正在读取桌面配置…"
                    : state === "waiting"
                      ? "连接已建立，正在加载桌面画面…"
                      : state === "connecting"
                        ? "正在连接 Mac…"
                        : status.desktop_configured
                          ? locked
                            ? "远程桌面已锁定"
                            : "连接 Mac 屏幕共享"
                          : "此入口尚未配置远程桌面")}
              </p>
              {status?.desktop_configured && state === "idle" && (
                <button className="btn cloud-primary" onClick={openPassword}>
                  {locked || error ? "重新连接" : "连接桌面"}
                </button>
              )}
              {status?.local && !status.desktop_configured && (
                <button className="btn" onClick={onSetup}>
                  云控设置
                </button>
              )}
            </div>
          )
        )}
      </div>
      <footer className="cloud-pane-footer">
        <span>
          {error && state === "connected" ? (
            <span role="status">{error}</span>
          ) : state === "connected" ? (
            <span role="status">
              {keyboardActive
                ? "键盘已接管 · Shift + Esc 退出"
                : "点击画面接管键盘"}
            </span>
          ) : (
            "主显示器"
          )}
        </span>
        <span>{resolution}</span>
        {state !== "idle" && (
          <button
            className="btn"
            ref={disconnectButton}
            onClick={() => {
              disconnect();
              setPasswordOpen(false);
              setError("");
            }}
          >
            {starting ? "取消连接" : "断开"}
          </button>
        )}
      </footer>
    </section>
  );
}
