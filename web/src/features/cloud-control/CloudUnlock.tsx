import { useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { reauthenticate } from "@features/accounts";
import { beginTotp, confirmTotp, verifyTotp } from "./cloudApi";

export function CloudUnlock({
  enroll,
  desktop = false,
  close,
  unlocked,
}: {
  enroll: boolean;
  desktop?: boolean;
  close: () => void;
  unlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [passwordChecked, setPasswordChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      if (!passwordChecked) {
        await reauthenticate(password);
        setPasswordChecked(true);
        setPassword("");
      }
      if (enroll && !secret) {
        setSecret((await beginTotp()).secret);
        return;
      }
      await (enroll ? confirmTotp(code) : verifyTotp(code, desktop));
      unlocked();
    } catch (failure) {
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
            {enroll ? "登记动态验证码" : "解锁云控操作"}
          </Dialog.Title>
          <Dialog.Description>
            {enroll
              ? "在本机验证密码，再将登记密钥手动添加到验证器。"
              : "输入管理员密码和验证器当前显示的六位验证码。"}
          </Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            {!passwordChecked && (
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
            )}
            {secret && (
              <label>
                登记密钥
                <input readOnly value={secret} autoComplete="off" />
              </label>
            )}
            {(!enroll || secret) && (
              <label>
                动态验证码
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="cloud-dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="btn">
                  取消
                </button>
              </Dialog.Close>
              <button type="submit" className="btn" disabled={pending}>
                {enroll && !secret ? "生成登记密钥" : "验证"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
