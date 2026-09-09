import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, UserRound, KeyRound, ShieldCheck, ScrollText } from "lucide-react";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import type { AccountSessionContext } from "./api";
import { useAccountWorkspacePanel } from "./useAccountWorkspacePanel";
import { AccountSettingsContent } from "./AccountSettingsContent";
import { WorkspaceDialogContent } from "./WorkspaceDialogContent";
import { AccountMenu } from "./AccountMenu";
import { WorkspaceTrigger } from "./WorkspaceTrigger";
import "./account-dialog.css";

export function AccountWorkspacePanel({
  session,
  hiddenEntries = false,
}: {
  session: AccountSessionContext;
  hiddenEntries?: boolean;
}) {
  const state = useAccountWorkspacePanel(session);
  const { open, tab, setTab, busy, error, notice, me, close } = state;
  const pendingAction = useRef<(() => void) | null>(null);
  const [confirming, setConfirming] = useState(false);
  const workspaceDirty =
    state.workspaceName !== me.workspace.name ||
    state.visibility !== me.workspace.visibility;
  const profileDirty =
    state.displayName !== me.user.display_name ||
    state.email !== (me.user.email || "");
  const dirty =
    open === "workspace"
      ? workspaceDirty
      : profileDirty ||
        !!state.currentPassword ||
        !!state.changedPassword ||
        !!state.changedPasswordAgain;
  const guard = (next: () => void) => {
    if (busy) return;
    if (dirty) {
      pendingAction.current = next;
      setConfirming(true);
    } else next();
  };
  const requestClose = () => guard(close);
  const focus = useDrawerFocus(
    () => {
      if (confirming) setConfirming(false);
      else requestClose();
    },
    !!open,
    false,
  );
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  const sections = [
    ["profile", "个人资料", UserRound],
    ["security", "密码与会话", ShieldCheck],
    ["keys", "API 密钥", KeyRound],
    ["events", "安全记录", ScrollText],
  ] as const;
  return (
    <>
      {!hiddenEntries ? (
        <>
          <WorkspaceTrigger session={session} />
          <AccountMenu session={session} />
        </>
      ) : null}
      {open
        ? createPortal(
            <div
              className="account-dialog-backdrop"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) requestClose();
              }}
            >
              <section
                ref={focus}
                className={`account-dialog ${open === "workspace" ? "account-dialog-workspace" : "account-dialog-settings"}`}
                role="dialog"
                aria-modal="true"
                aria-label={
                  confirming
                    ? "放弃未保存的更改"
                    : open === "workspace"
                      ? "工作区"
                      : "账号设置"
                }
              >
                <header className="account-dialog-heading">
                  <div>
                    <h2>
                      {confirming
                        ? "放弃未保存的更改？"
                        : open === "workspace"
                          ? "工作区"
                          : "账号设置"}
                    </h2>
                    <p>
                      {confirming
                        ? "你的修改尚未保存，可以返回继续编辑。"
                        : open === "workspace"
                          ? "切换或管理你的工作区"
                          : "管理个人资料、登录安全与访问密钥"}
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="关闭"
                    disabled={busy}
                    onClick={() =>
                      confirming ? setConfirming(false) : requestClose()
                    }
                  >
                    <X size={22} />
                  </button>
                </header>
                {confirming ? (
                  <div className="account-discard">
                    <button
                      className="btn"
                      autoFocus
                      onClick={() => setConfirming(false)}
                    >
                      继续编辑
                    </button>
                    <button
                      className="btn danger"
                      onClick={() => {
                        setConfirming(false);
                        const next = pendingAction.current;
                        pendingAction.current = null;
                        close();
                        next?.();
                      }}
                    >
                      放弃更改
                    </button>
                  </div>
                ) : (
                  <>
                    {error ? (
                      <div
                        className="account-dialog-message danger"
                        role="alert"
                      >
                        {error}{" "}
                        <button
                          className="btn small"
                          onClick={() => void state.reload()}
                        >
                          重新加载
                        </button>
                      </div>
                    ) : null}
                    {notice ? (
                      <div className="account-dialog-message" role="status">
                        {notice}
                      </div>
                    ) : null}
                    {open === "workspace" ? (
                      <WorkspaceDialogContent
                        state={state}
                        guard={guard}
                        close={requestClose}
                      />
                    ) : (
                      <div className="account-settings-body">
                        <nav aria-label="账号设置">
                          <div className="account-settings-identity">
                            <span className="account-identity-avatar">
                              {me.user.avatar_url ? (
                                <img src={me.user.avatar_url} alt="" />
                              ) : (
                                me.user.display_name.slice(0, 1)
                              )}
                            </span>
                            <strong>{me.user.display_name}</strong>
                            <small>@{me.user.username}</small>
                          </div>
                          {sections.map(([id, label, Icon]) => (
                            <button
                              key={id}
                              className={tab === id ? "active" : ""}
                              aria-current={tab === id ? "page" : undefined}
                              onClick={() => {
                                state.clearSecret();
                                setTab(id);
                              }}
                            >
                              <Icon size={18} />
                              {label}
                            </button>
                          ))}
                        </nav>
                        <div
                          className="account-settings-content"
                          aria-busy={busy}
                        >
                          <AccountSettingsContent state={state} />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
