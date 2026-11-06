import { useEffect, useRef, useState } from "react";
import { ApiError, apiErrorMessage } from "@platform/api/errors";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { reauthenticate, revealApiKeySecret, type ApiKey } from "./api";

export function ApiKeySecretDialog({
  apiKey,
  close,
}: {
  apiKey: ApiKey;
  close: () => void;
}) {
  const [secret, setSecret] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const secretInput = useRef<HTMLInputElement>(null);
  const keyId = apiKey.id;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    request.current = controller;
    // Strict Mode can cancel the first effect setup before the request starts.
    queueMicrotask(() => {
      if (signal.aborted) return;
      void revealApiKeySecret(keyId, signal)
        .then(({ secret }) => {
          if (!signal.aborted) setSecret(secret);
        })
        .catch((reason: unknown) => {
          if (signal.aborted) return;
          if (
            reason instanceof ApiError &&
            reason.problem.code === "reauthentication_required"
          ) {
            setNeedsPassword(true);
          } else {
            setError(apiErrorMessage(reason));
          }
        })
        .finally(() => {
          if (!signal.aborted) setBusy(false);
        });
    });
    return () => controller.abort();
  }, [keyId]);

  useEffect(() => {
    if (busy) return;
    if (secret) secretInput.current?.focus();
    else if (needsPassword) passwordInput.current?.focus();
  }, [busy, needsPassword, secret]);

  const verify = async () => {
    const signal = request.current?.signal;
    if (!signal || signal.aborted || busy || !password) return;
    setBusy(true);
    setError("");
    try {
      await reauthenticate(password, signal);
      if (signal.aborted) return;
      setPassword("");
      const result = await revealApiKeySecret(keyId, signal);
      if (!signal.aborted) setSecret(result.secret);
    } catch (reason) {
      if (!signal.aborted) setError(apiErrorMessage(reason));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };

  const copy = async () => {
    const signal = request.current?.signal;
    if (!signal || signal.aborted) return;
    try {
      await navigator.clipboard.writeText(secret);
      if (signal.aborted) return;
      setError("");
      setCopied(true);
    } catch {
      if (signal.aborted) return;
      setCopied(false);
      setError("无法写入剪贴板，请手动复制已选中的密钥。");
      secretInput.current?.focus();
      secretInput.current?.select();
    }
  };

  return (
    <ConfirmDialog
      open
      tone="primary"
      title={`查看并复制“${apiKey.name}”`}
      cancelLabel="关闭"
      confirmLabel={secret ? "复制密钥" : "验证并查看"}
      confirmDisabled={busy || (!secret && (!needsPassword || !password))}
      onCancel={() => {
        request.current?.abort();
        close();
      }}
      onConfirm={secret ? copy : verify}
      description={
        <div className="api-key-reveal-fields">
          {secret ? (
            <label>
              完整密钥
              <input
                ref={secretInput}
                readOnly
                value={secret}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ) : needsPassword ? (
            <label>
              验证账号密码
              <input
                ref={passwordInput}
                type="password"
                autoComplete="current-password"
                disabled={busy}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void verify();
                  }
                }}
              />
            </label>
          ) : null}
          {busy ? <p role="status">正在验证访问权限…</p> : null}
          {copied ? <p role="status">密钥已复制。</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      }
    />
  );
}
