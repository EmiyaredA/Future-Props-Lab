import { useState } from "react";
import { api, unwrap } from "@platform/api/client";
import { BrandMark } from "@shared/ui/BrandMark";
import { reauthenticate, logout, type AuthMe } from "./api";

export function AccountStorageUpgrade({ me }: { me: AuthMe }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-busy={busy}>
        <BrandMark size={52} />
        <h1>升级账号文件布局</h1>
        <p>项目已改为账号归属。完成文件核验前，业务任务暂停运行。</p>
        {me.user.platform_role === "admin" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              setMessage("");
              void (async () => {
                await reauthenticate(password);
                setPassword("");
                const result = await unwrap(
                  await api.POST("/v1/file-storage/layout/migrate"),
                );
                setMessage(
                  result.complete
                    ? "文件核验完成。请关闭并重新启动应用，以恢复业务任务。"
                    : "部分文件尚未迁移，请检查源文件或目标冲突后重试。原始文件已保留。",
                );
              })()
                .catch((reason) =>
                  setError(
                    reason instanceof Error ? reason.message : "文件迁移失败",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <label>
              管理员密码
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={busy}>
              {busy ? "正在迁移并核验…" : "迁移并核验文件"}
            </button>
          </form>
        ) : (
          <p>请联系管理员完成升级并重启应用。</p>
        )}
        {error && (
          <p className="inline-alert danger" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button
          className="btn"
          disabled={busy}
          onClick={() => void logout().then(() => window.location.reload())}
        >
          退出登录
        </button>
      </section>
    </main>
  );
}
