import { LoadingState } from "@shared/ui/LoadingState";
import { AccountStorageUpgrade } from "@features/accounts/AccountStorageUpgrade";
import { registerAccount } from "@features/accounts/platformApi";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";
import {
  type FormEvent,
  Fragment,
  useRef,
  useCallback,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AUTH_REQUIRED_EVENT } from "@platform/api/studioAuth";
import { ApiError } from "@platform/api/client";
import { BrandMark } from "@shared/ui/BrandMark";
import {
  type AuthMe,
  SessionContext,
  type SessionContextValue,
} from "@app/StudioSession";
import {
  changePassword,
  getMe,
  login as loginAccount,
  logout as logoutAccount,
} from "@features/accounts/api";
import { clearRetainedRealtimeVoiceState } from "@features/models/realtime/realtimeVoiceMemory";
import { useResourceBroadcastSync } from "@app/useResourceBroadcastSync";

type Status = "checking" | "signed-out" | "signed-in";
const registrationAllowed = import.meta.env.MODE !== "studio";

export function StudioAuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const identityRef = useRef<AuthMe | null>(null);
  const identityRequest = useRef(0);
  const [status, setStatus] = useState<Status>("checking");
  const [me, setMe] = useState<AuthMe | null>(null);
  useResourceBroadcastSync(queryClient, status === "signed-in");
  const userId = me?.user.id;
  useEffect(() => {
    if (userId)
      localStorage.removeItem(`amadeus-appearance:${userId}:${userId}`);
  }, [userId]);
  identityRef.current = me;
  const [registration, setRegistration] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [registrationEmail, setRegistrationEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const request = ++identityRequest.current;
    try {
      const current = await getMe();
      if (request !== identityRequest.current) return;
      const previous = identityRef.current;
      if (
        previous &&
        (previous.user.id !== current.user.id ||
          JSON.stringify(previous.permission_keys) !==
            JSON.stringify(current.permission_keys))
      ) {
        clearRetainedRealtimeVoiceState();
        await queryClient.cancelQueries();
        queryClient.clear();
      }
      if (request !== identityRequest.current) return;
      identityRef.current = current;
      setMe(current);
      setStatus("signed-in");
    } catch (cause) {
      if (request !== identityRequest.current) return;
      if (!identityRef.current) {
        if (cause instanceof ApiError && cause.status !== 401)
          setError("网站服务暂时离线，请检查 Mac 网站服务状态后重试。");
        setMe(null);
        setStatus("signed-out");
      }
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
    const signedOut = () => {
      identityRequest.current += 1;
      clearRetainedRealtimeVoiceState();
      queryClient.clear();
      identityRef.current = null;
      setMe(null);
      setStatus("signed-out");
    };
    const permissionsChanged = () => {
      if (!document.hidden && identityRef.current) void refresh();
    };
    const timer = window.setInterval(permissionsChanged, 30000);
    window.addEventListener("focus", permissionsChanged);
    window.addEventListener(
      "future-props:permissions-changed",
      permissionsChanged,
    );
    window.addEventListener(AUTH_REQUIRED_EVENT, signedOut);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", permissionsChanged);
      window.removeEventListener(
        "future-props:permissions-changed",
        permissionsChanged,
      );
      window.removeEventListener(AUTH_REQUIRED_EVENT, signedOut);
    };
  }, [queryClient, refresh]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const current = registration
        ? await registerAccount({
            display_name: username,
            username,
            password,
            invite_code: inviteCode,
            email: registrationEmail || null,
          })
        : await loginAccount(username, password);
      setInviteCode("");
      setRegistrationEmail("");
      setRegistration(false);
      clearRetainedRealtimeVoiceState();
      setMe(current);
      setStatus("signed-in");
      setUsername("");
      setPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await changePassword(password, newPassword);
      setPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "密码修改失败");
    } finally {
      setBusy(false);
    }
  };

  const context = useMemo<SessionContextValue | null>(() => {
    if (!me) return null;
    return {
      me,
      refresh,
      logout: async () => {
        await logoutAccount();
        identityRequest.current += 1;
        identityRef.current = null;
        clearRetainedRealtimeVoiceState();
        queryClient.clear();
        setMe(null);
        setStatus("signed-out");
      },
    };
  }, [me, queryClient, refresh]);

  if (status === "checking") {
    return (
      <LoadingState
        label="正在连接 Future Props Lab…"
        variant="page"
        className="fpl-loading--fullscreen"
      />
    );
  }

  if (status === "signed-out" || !me || !context) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={(event) => void login(event)}>
          <BrandMark size={52} />
          <div>
            <h1>
              {registration ? "注册 Future Props Lab" : "登录 Future Props Lab"}
            </h1>
            <p>
              {registration
                ? "使用邀请码创建个人账号。"
                : registrationAllowed
                  ? "使用已有账号登录，或通过邀请码注册。"
                  : "使用已有 Future Props Lab 账号登录。"}
            </p>
          </div>
          <label>
            <span>用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {registration && (
            <>
              <label>
                <span>邮箱（选填）</span>
                <input
                  type="email"
                  value={registrationEmail}
                  onChange={(e) => setRegistrationEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
              <label>
                <span>邀请码</span>
                <input
                  required
                  autoComplete="off"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </label>
              <small>密码需为 10–128 位，避免使用常见密码。</small>
            </>
          )}
          {error ? <div className="inline-alert danger">{error}</div> : null}
          <button
            className="btn primary"
            disabled={busy || !username || !password}
          >
            {busy ? (
              <LoadingState variant="inline" label="正在处理…" />
            ) : registration ? (
              "注册并登录"
            ) : (
              "登录"
            )}
          </button>
          {registrationAllowed && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setRegistration(!registration);
                setPassword("");
                setInviteCode("");
                setError("");
              }}
            >
              {registration ? "已有账号，返回登录" : "使用邀请码注册"}
            </button>
          )}
        </form>
      </main>
    );
  }

  if (me.must_change_password) {
    return (
      <main className="auth-screen">
        <form
          className="auth-card"
          onSubmit={(event) => void updatePassword(event)}
        >
          <BrandMark size={52} />
          <div>
            <h1>设置你的新密码</h1>
            <p>临时密码只能使用一次。修改后，其他设备上的会话会自动退出。</p>
          </div>
          <label>
            <span>当前临时密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </label>
          <label>
            <span>新密码</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            <span>确认新密码</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          {error ? <div className="inline-alert danger">{error}</div> : null}
          <button
            className="btn primary"
            disabled={busy || !password || !newPassword || !confirmPassword}
          >
            {busy ? (
              <LoadingState variant="inline" label="保存中…" />
            ) : (
              "保存并继续"
            )}
          </button>
        </form>
      </main>
    );
  }

  if (me.storage_upgrade_required) return <AccountStorageUpgrade me={me} />;

  return (
    <SessionContext.Provider value={context}>
      <AccountAccessProvider
        userId={me.user.id}
        permissions={me.permission_keys || []}
      >
        {error ? (
          <div className="inline-alert danger" role="alert">
            {error}
            <button className="btn small" onClick={() => setError("")}>
              关闭
            </button>
          </div>
        ) : null}
        <Fragment
          key={`${me.user.id}:${me.user.is_platform_admin}:${me.permission_keys?.join(",")}`}
        >
          {children}
        </Fragment>
      </AccountAccessProvider>
    </SessionContext.Provider>
  );
}
