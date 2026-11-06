import { useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { reauthenticate } from "@features/accounts";
import { unlockCloud, type CloudUnlockPurpose } from "./cloudApi";

export function CloudUnlock({
  purpose,
  close,
  unlocked,
}: {
  purpose: CloudUnlockPurpose;
  close: () => void;
  unlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await reauthenticate(password);
      await unlockCloud(purpose);
      unlocked();
    } catch (failure) {
      setPassword("");
      setError(failure instanceof Error ? failure.message : "验证失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cloud-dialog-overlay" />
        <Dialog.Content className="cloud-dialog">
          <Dialog.Title>
            {purpose === "desktop" ? "验证桌面访问权限" : "解锁云控操作"}
          </Dialog.Title>
          <Dialog.Description>
            {purpose === "desktop"
              ? "验证 FPL 管理员密码后，即可输入 VNC 密码连接桌面。"
              : "输入 FPL 管理员密码，解锁 Agent 工作台 15 分钟。"}
          </Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              管理员密码
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="cloud-dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="btn">
                  取消
                </button>
              </Dialog.Close>
              <button type="submit" className="btn" disabled={pending}>
                验证
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
