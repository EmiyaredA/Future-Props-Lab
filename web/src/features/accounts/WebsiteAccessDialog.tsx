import "./website-access.css";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { api, unwrap } from "@platform/api/client";

import type { components } from "@generated/api";
type AccessStatus = components["schemas"]["AccessStatus"];
export default function WebsiteAccessDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const [status, setStatus] = useState<AccessStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try {
      setStatus(await unwrap(await api.GET("/v1/automation/access")));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "读取失败");
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const action = async (value: "public_start" | "public_stop" | "check") => {
    setBusy(true);
    setError("");
    try {
      setStatus(
        await unwrap(
          await api.POST("/v1/automation/access/actions", {
            body: { action: value },
          }),
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="website-access-overlay" />
        <Dialog.Content
          className="website-access-dialog"
          aria-describedby="website-access-description"
        >
          <Dialog.Title>本地与公网访问</Dialog.Title>
          <Dialog.Description id="website-access-description">
            网站由 Mac 后台服务运行。此管理面板仅向本机入口的平台管理员开放。
          </Dialog.Description>
          <p>本机入口：http://127.0.0.1:9000</p>
          <p>公网入口：{status?.public?.url || "未配置"}</p>
          <p role="status">状态：{status?.public?.phase || "正在读取…"}</p>
          {status?.public?.error && <p role="alert">{status.public.error}</p>}
          <p>
            网关、专用凭据和自动启动设置保存在
            backend/config.toml；配置变更须按停机备份流程应用。
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="website-access-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={() => void action("check")}
            >
              检查连接
            </button>
            <button
              className="btn"
              disabled={busy || !status}
              onClick={() => void action("public_start")}
            >
              开启公网
            </button>
            <button
              className="btn"
              disabled={busy || !status}
              onClick={() => void action("public_stop")}
            >
              关闭公网
            </button>
            <Dialog.Close asChild>
              <button className="btn">关闭</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
