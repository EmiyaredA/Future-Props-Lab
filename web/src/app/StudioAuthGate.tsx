import { FormEvent, ReactNode, useEffect, useState } from "react";
import { api, unwrap } from "@platform/api/client";
import {
  AUTH_REQUIRED_EVENT,
  clearStudioToken,
  getStudioToken,
  setStudioToken,
} from "@platform/api/studioAuth";
import { BrandMark } from "@shared/ui/BrandMark";

type Status = "checking" | "locked" | "unlocked";

export function StudioAuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [authRequired, setAuthRequired] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const check = async () => {
    try {
      const result = await unwrap(await api.GET("/v1/studio/auth/check"));
      setAuthRequired(result.auth_required);
      setStatus(
        result.auth_required && !getStudioToken() ? "locked" : "unlocked",
      );
      return true;
    } catch {
      setStatus("locked");
      return false;
    }
  };

  useEffect(() => {
    void check();
    const lock = () => setStatus("locked");
    window.addEventListener(AUTH_REQUIRED_EVENT, lock);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, lock);
  }, []);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    setStudioToken(token);
    setBusy(true);
    setError("");
    if (await check()) {
      setToken("");
    } else {
      clearStudioToken();
      setError("令牌无效，请检查后重试");
    }
    setBusy(false);
  };

  if (status === "checking") {
    return (
      <main className="auth-screen">
        <p>正在连接 Future Props Lab…</p>
      </main>
    );
  }
  if (status === "locked") {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={(event) => void unlock(event)}>
          <BrandMark size={52} />
          <h1>解锁模型管理台</h1>
          <p>输入管理令牌。令牌只保存在当前浏览器会话。</p>
          <input
            type="password"
            autoComplete="current-password"
            aria-label="管理令牌"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoFocus
          />
          {error ? <div className="inline-alert danger">{error}</div> : null}
          <button className="btn primary" disabled={busy || !token.trim()}>
            {busy ? "验证中…" : "解锁"}
          </button>
        </form>
      </main>
    );
  }
  return (
    <>
      {children}
      {authRequired ? (
        <button
          className="studio-lock"
          type="button"
          onClick={() => {
            clearStudioToken();
            setStatus("locked");
          }}
        >
          锁定
        </button>
      ) : null}
    </>
  );
}
