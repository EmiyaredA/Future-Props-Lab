import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";
import "@platform/desktop";
import { BrandMark } from "@shared/ui/BrandMark";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { login } from "./api";
import "./desktop-setup.css";

export function DesktopSetupGate({ children }: { children: ReactNode }) {
  const desktop = Boolean(window.futurePropsDesktop);
  const [required, setRequired] = useState<boolean | null>(
    desktop ? null : false,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);

  async function check() {
    setError("");
    try {
      const result = await unwrap(await api.GET("/v1/desktop/setup"));
      setRequired(result.setup_required);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法查询初始化状态");
    }
  }

  useEffect(() => {
    if (desktop) void check();
    return window.futurePropsDesktop?.onQuitRequested((approve) => {
      const event = new CustomEvent("future-props:before-navigation", {
        cancelable: true,
        detail: approve,
      });
      if (window.dispatchEvent(event)) approve();
    });
  }, [desktop]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    let created = false;
    try {
      const body: components["schemas"]["DesktopSetupIn"] = {
        username: username.trim(),
        display_name: displayName.trim(),
        password,
      };
      await unwrap(await api.POST("/v1/desktop/setup", { body }));
      created = true;
      await login(username.trim(), password);
      setRequired(false);
    } catch (cause) {
      if (created)
        setRequired(false); // Account exists; normal login can recover.
      else
        setError(cause instanceof Error ? cause.message : "初始化失败，请重试");
    } finally {
      setPassword("");
      setConfirmation("");
      setPasswordVisible(false);
      setConfirmationVisible(false);
      setBusy(false);
    }
  }

  if (required === false) return children;
  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <BrandMark />
        <h1>欢迎来到本地研究所</h1>
        <p>创建这台 Mac 上的首个管理员。账号和作品仅保存在本机。</p>
        {required === null ? (
          <>
            <p role="status">{error || "正在检查首次使用状态…"}</p>
            {error && (
              <button
                className="btn"
                type="button"
                onClick={() => void check()}
              >
                重试
              </button>
            )}
          </>
        ) : (
          <>
            <label>
              账号
              <input
                autoComplete="username"
                required
                minLength={3}
                maxLength={64}
                pattern="[A-Za-z0-9._-]{3,64}"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              显示名称
              <input
                autoComplete="nickname"
                maxLength={128}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={busy}
              />
            </label>
            <div className="desktop-setup-field">
              <label htmlFor="desktop-setup-password">密码</label>
              <span className="desktop-setup-password">
                <input
                  id="desktop-setup-password"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="desktop-setup-password__toggle"
                  aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                  aria-pressed={passwordVisible}
                  disabled={busy}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? (
                    <EyeOff aria-hidden="true" />
                  ) : (
                    <Eye aria-hidden="true" />
                  )}
                </button>
              </span>
            </div>
            <div className="desktop-setup-field">
              <label htmlFor="desktop-setup-password-confirmation">
                确认密码
              </label>
              <span className="desktop-setup-password">
                <input
                  id="desktop-setup-password-confirmation"
                  type={confirmationVisible ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={128}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="desktop-setup-password__toggle"
                  aria-label={
                    confirmationVisible ? "隐藏确认密码" : "显示确认密码"
                  }
                  aria-pressed={confirmationVisible}
                  disabled={busy}
                  onClick={() => setConfirmationVisible((visible) => !visible)}
                >
                  {confirmationVisible ? (
                    <EyeOff aria-hidden="true" />
                  ) : (
                    <Eye aria-hidden="true" />
                  )}
                </button>
              </span>
            </div>
            <p>账号为 3–64 位字母、数字或 . _ -，密码为 10–128 位。</p>
            {error && <p role="alert">{error}</p>}
            <button
              className="desktop-setup-submit"
              type="submit"
              disabled={busy}
              aria-busy={busy}
            >
              <span>{busy ? "正在创建…" : "创建管理员并进入"}</span>
              {busy ? (
                <LoaderCircle
                  className="desktop-setup-submit__spinner"
                  size={19}
                  aria-hidden="true"
                />
              ) : (
                <ArrowRight size={19} aria-hidden="true" />
              )}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
