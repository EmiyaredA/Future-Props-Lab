import { useNavigationProtection } from "@shared/ui/navigationGuards";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, UserRound, KeyRound, ShieldCheck, ScrollText } from "lucide-react";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import type { AccountSessionContext } from "./api";
import { useAccountPanel } from "./useAccountPanel";
import { AccountSettingsContent } from "./AccountSettingsContent";
import { AccountMenu } from "./AccountMenu";
import "./account-dialog.css";

export function AccountPanel({
  session,
  hiddenEntries = false,
}: {
  session: AccountSessionContext;
  hiddenEntries?: boolean;
}) {
  const navigation = useNavigationProtection();
  const state = useAccountPanel(session);
  const { open, busy, close } = state;
  const [confirming, setConfirming] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const dirty =
    state.displayName !== state.me.user.display_name ||
    state.email !== (state.me.user.email || "") ||
    !!state.currentPassword ||
    !!state.changedPassword ||
    !!state.changedPasswordAgain;
  const requestClose = () => {
    if (state.busy) return;
    if (dirty) {
      pending.current = state.close;
      setConfirming(true);
    } else state.close();
  };
  useEffect(() => {
    if (!navigation || !open) return;
    return navigation.register((resume) => {
      if (!dirty && !busy) return false;
      if (!busy) {
        pending.current = () => {
          close();
          resume();
        };
        setConfirming(true);
      }
      return true;
    });
  }, [navigation, open, dirty, busy, close]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const beforeNavigation = (event: Event) => {
      if (navigation) return;
      if (!dirty && !busy) return;
      event.preventDefault();
      if (busy) return;
      const resume = (event as CustomEvent<() => void>).detail;
      pending.current = () => {
        close();
        resume?.();
      };
      setConfirming(true);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (navigation?.allowsUnload()) return;
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("future-props:before-navigation", beforeNavigation);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener(
        "future-props:before-navigation",
        beforeNavigation,
      );
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [open, busy, close, dirty, navigation]);
  const focus = useDrawerFocus<HTMLElement>(
    requestClose,
    !!state.open && !confirming,
    false,
  );
  const sections = [
    ["profile", "个人资料", UserRound],
    ["security", "密码与会话", ShieldCheck],
    ["keys", "API 密钥", KeyRound],
    ["events", "安全记录", ScrollText],
  ] as const;
  return (
    <>
      {!hiddenEntries && <AccountMenu session={session} />}
      {state.open &&
        createPortal(
          <div
            className="account-dialog-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) requestClose();
            }}
          >
            <section
              ref={focus}
              className={`account-dialog account-dialog-settings${state.tab === "keys" ? " account-dialog-settings-keys" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label="账号设置"
            >
              <header className="account-dialog-heading">
                <div className="account-dialog-heading-copy">
                  <h2>账号设置</h2>
                  <p>管理个人资料、登录安全与访问密钥</p>
                </div>
                <button
                  className="icon-button"
                  aria-label="关闭"
                  disabled={state.busy}
                  onClick={requestClose}
                >
                  <X size={22} />
                </button>
              </header>
              {state.error && (
                <div className="account-dialog-message danger" role="alert">
                  {state.error}
                  <button
                    className="btn small"
                    disabled={state.busy || state.loading}
                    onClick={() => void state.reload()}
                  >
                    重新加载
                  </button>
                </div>
              )}
              {state.notice && (
                <div className="account-dialog-message" role="status">
                  {state.notice}
                </div>
              )}
              <div className="account-settings-body">
                <nav aria-label="账号设置">
                  {sections.map(([id, label, Icon]) => (
                    <button
                      key={id}
                      className={state.tab === id ? "active" : ""}
                      aria-current={state.tab === id ? "page" : undefined}
                      onClick={() => {
                        state.clearSecret();
                        state.setTab(id);
                      }}
                    >
                      <Icon size={18} />
                      {label}
                    </button>
                  ))}
                </nav>
                <div
                  className="account-settings-content"
                  aria-busy={state.busy}
                >
                  <AccountSettingsContent state={state} />
                </div>
              </div>
            </section>
          </div>,
          document.body,
        )}
      <ConfirmDialog
        open={confirming}
        title="放弃未保存的更改？"
        description="你的修改尚未保存，可以返回继续编辑。"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          pending.current?.();
          pending.current = null;
        }}
      />
    </>
  );
}
