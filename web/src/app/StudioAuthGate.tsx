import {
  type FormEvent,
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
  sessionRequest,
} from "@app/StudioSession";

type Status = "checking" | "signed-out" | "signed-in";

export function StudioAuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("checking");
  const [me, setMe] = useState<AuthMe | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const current = await sessionRequest<AuthMe>("/v1/auth/me");
      setMe(current);
      setStatus("signed-in");
    } catch {
      setMe(null);
      setStatus("signed-out");
    }
  };

  useEffect(() => {
    void refresh();
    const signedOut = () => {
      setMe(null);
      setStatus("signed-out");
    };
    const workspaceChanged = () => window.location.reload();
    window.addEventListener(AUTH_REQUIRED_EVENT, signedOut);
    window.addEventListener(WORKSPACE_CHANGED_EVENT, workspaceChanged);
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("future-props-workspace");
    if (channel) channel.onmessage = workspaceChanged;
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, signedOut);
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, workspaceChanged);
      channel?.close();
    };
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const current = await sessionRequest<AuthMe>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
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
      await sessionRequest<void>("/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: password,
          new_password: newPassword,
        }),
      });
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
        await sessionRequest<void>("/v1/auth/logout", { method: "POST" });
        queryClient.clear();
        setMe(null);
        setStatus("signed-out");
      },
      switchWorkspace: async (workspaceId: string) => {
        await sessionRequest("/v1/account/workspaces/switch", {
          method: "POST",
          body: JSON.stringify({ workspace_id: workspaceId }),
        });
        queryClient.clear();
        if (typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel("future-props-workspace");
          channel.postMessage({ workspace_id: workspaceId });
          channel.close();
        }
        window.location.assign("/home");
      },
    };
  }, [me, queryClient]);

  if (status === "checking") {
    return <main className="auth-screen">正在连接 Future Props Lab…</main>;
  }

  if (status === "signed-out" || !me || !context) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={(event) => void login(event)}>
          <BrandMark size={52} />
          <div>
            <h1>登录 Future Props Lab</h1>
            <p>使用管理员为你创建的账号登录。</p>
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
          {error ? <div className="inline-alert danger">{error}</div> : null}
          <button
            className="btn primary"
            disabled={busy || !username || !password}
          >
            {busy ? "登录中…" : "登录"}
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
      {children}
    </SessionContext.Provider>
  );
}
