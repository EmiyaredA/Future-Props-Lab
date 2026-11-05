import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SessionContext } from "@app/StudioSession";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";
import { AUTH_REQUIRED_EVENT } from "@platform/api/studioAuth";
import {
  changePassword,
  getMe,
  login,
  logout,
  type AuthMe,
} from "@features/accounts/api";
import { BrandMark } from "@shared/ui/BrandMark";

export function ManagementAuthGate({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const identity = useRef<AuthMe | null>(null);
  const identityRequest = useRef(0);
  const [me, setMe] = useState<AuthMe | null>(null);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const request = ++identityRequest.current;
    const value = await getMe();
    if (request !== identityRequest.current) return;
    if (!value.user.is_platform_admin) throw new Error("需要平台管理员账号");
    const previous = identity.current;
    if (
      previous &&
      (previous.user.id !== value.user.id ||
        JSON.stringify(previous.permission_keys) !==
          JSON.stringify(value.permission_keys))
    ) {
      await cache.cancelQueries();
      cache.clear();
    }
    if (request !== identityRequest.current) return;
    identity.current = value;
    setMe(value);
  }, [cache]);
  useEffect(() => {
    let active = true;
    void refresh()
      .catch(() => {})
      .finally(() => {
        if (active) setChecking(false);
      });
    const signedOut = () => {
      identityRequest.current += 1;
      identity.current = null;
      cache.clear();
      setMe(null);
    };
    const update = () => {
      if (!document.hidden) void refresh().catch(signedOut);
    };
    const timer = window.setInterval(update, 30000);
    window.addEventListener(AUTH_REQUIRED_EVENT, signedOut);
    window.addEventListener("focus", update);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(AUTH_REQUIRED_EVENT, signedOut);
      window.removeEventListener("focus", update);
    };
  }, [cache, refresh]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (me?.must_change_password) {
        if (newPassword !== confirmation)
          throw new Error("两次输入的新密码不一致");
        await changePassword(password, newPassword);
        await refresh();
      } else {
        const value = await login(username, password);
        if (!value.user.is_platform_admin)
          throw new Error("需要平台管理员账号");
        identityRequest.current += 1;
        identity.current = value;
        cache.clear();
        setMe(value);
      }
      setPassword("");
      setNewPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "管理端暂不可用，请重试",
      );
    } finally {
      setBusy(false);
    }
  };
  if (checking)
    return (
      <div role="status" className="auth-screen">
        正在连接管理服务…
      </div>
    );
  if (!me || me.must_change_password)
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={(event) => void submit(event)}>
          <BrandMark size={52} />
          <div>
            <h1>{me ? "设置新的管理员密码" : "登录管理中台"}</h1>
            <p>使用现有平台管理员账号，管理会话独立于业务应用。</p>
          </div>
          {!me && (
            <label>
              用户名
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
          )}
          <label>
            {me ? "当前临时密码" : "密码"}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {me && (
            <>
              <label>
                新密码
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <label>
                确认新密码
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="inline-alert danger">
              {error}
            </p>
          )}
          <button className="btn primary" disabled={busy}>
            {busy ? "正在处理…" : me ? "保存并继续" : "登录"}
          </button>
        </form>
      </main>
    );
  return (
    <SessionContext
      value={{
        me,
        refresh,
        logout: async () => {
          await logout();
          identityRequest.current += 1;
          identity.current = null;
          cache.clear();
          setMe(null);
        },
      }}
    >
      <AccountAccessProvider
        userId={me.user.id}
        permissions={me.permission_keys || []}
      >
        {children}
      </AccountAccessProvider>
    </SessionContext>
  );
}
