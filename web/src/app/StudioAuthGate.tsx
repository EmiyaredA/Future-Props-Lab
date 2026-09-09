import { registerAccount } from "@features/accounts/platformApi";
import { WorkspacePermissionsProvider } from "@platform/auth/WorkspacePermissions";
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
import {
  AUTH_REQUIRED_EVENT,
  WORKSPACE_CHANGED_EVENT,
} from "@platform/api/studioAuth";
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
  switchWorkspace as switchAccountWorkspace,
} from "@features/accounts/api";
import { clearRetainedRealtimeVoiceState } from "@features/models/realtime/realtimeVoiceMemory";

type Status = "checking" | "signed-out" | "signed-in";

export function StudioAuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const identityRef = useRef<AuthMe | null>(null);
  const identityRequest = useRef(0);
  const [status, setStatus] = useState<Status>("checking");
  const [me, setMe] = useState<AuthMe | null>(null);
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
          previous.workspace.id !== current.workspace.id ||
          JSON.stringify(previous.workspace.permission_keys) !==
            JSON.stringify(current.workspace.permission_keys))
      ) {
        clearRetainedRealtimeVoiceState();
        await queryClient.cancelQueries();
        queryClient.clear();
      }
      if (request !== identityRequest.current) return;
      identityRef.current = current;
      setMe(current);
      setStatus("signed-in");
    } catch {
      if (request !== identityRequest.current) return;
      if (!identityRef.current) {
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
    const workspaceChanged = () => {
      const event = new CustomEvent("future-props:before-workspace-switch", {
        cancelable: true,
        detail: () => window.location.reload(),
      });
      if (window.dispatchEvent(event)) window.location.reload();
    };
    const permissionsChanged = () => {
      if (identityRef.current) void refresh();
    };
    const timer = window.setInterval(permissionsChanged, 30000);
    window.addEventListener("focus", permissionsChanged);
    window.addEventListener(
      "future-props:permissions-changed",
      permissionsChanged,
    );
    window.addEventListener(AUTH_REQUIRED_EVENT, signedOut);
    window.addEventListener(WORKSPACE_CHANGED_EVENT, workspaceChanged);
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("future-props-workspace");
    if (channel) channel.onmessage = workspaceChanged;
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", permissionsChanged);
      window.removeEventListener(
        "future-props:permissions-changed",
        permissionsChanged,
      );
      window.removeEventListener(AUTH_REQUIRED_EVENT, signedOut);
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, workspaceChanged);
      channel?.close();
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
      switchWorkspace: async (workspaceId: string) => {
        const perform = async () => {
          await switchAccountWorkspace(workspaceId);
          clearRetainedRealtimeVoiceState();
          queryClient.clear();
          if (typeof BroadcastChannel !== "undefined") {
            const channel = new BroadcastChannel("future-props-workspace");
            channel.postMessage({ workspace_id: workspaceId });
            channel.close();
          }
          window.location.assign("/home");
        };
        const event = new CustomEvent("future-props:before-workspace-switch", {
          cancelable: true,
          detail: () => {
            void perform().catch((reason: unknown) => {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "工作区切换失败，请重试",
              );
            });
          },
        });
        if (window.dispatchEvent(event)) await perform();
      },
    };
  }, [me, queryClient, refresh]);

  if (status === "checking") {
    return <main className="auth-screen">正在连接 Future Props Lab…</main>;
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
                ? "使用邀请码创建个人账号与工作区。"
                : "使用已有账号登录，或通过邀请码注册。"}
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
            {busy ? "正在处理…" : registration ? "注册并登录" : "登录"}
          </button>
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
            {busy ? "保存中…" : "保存并继续"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <SessionContext.Provider value={context}>
      <WorkspacePermissionsProvider
        permissions={me.workspace.permission_keys || []}
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
          key={`${me.user.id}:${me.workspace.id}:${me.user.is_platform_admin}:${me.workspace.permission_keys?.join(",")}`}
        >
          {children}
        </Fragment>
      </WorkspacePermissionsProvider>
    </SessionContext.Provider>
  );
}
