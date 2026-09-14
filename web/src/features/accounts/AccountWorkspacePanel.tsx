import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  X,
  UserRound,
  KeyRound,
  ShieldCheck,
  ScrollText,
} from "lucide-react";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import type { AccountSessionContext } from "./api";
import { useAccountWorkspacePanel } from "./useAccountWorkspacePanel";
import { AccountSettingsContent } from "./AccountSettingsContent";
import { WorkspaceDialogContent } from "./WorkspaceDialogContent";
import { AccountMenu } from "./AccountMenu";
import { WorkspaceTrigger } from "./WorkspaceTrigger";
import { WorkspaceManagementDialog } from "./WorkspaceManagementDialog";
import { WorkspaceInvitationsDialog } from "./WorkspaceInvitationsDialog";
import type { WorkspaceManagementTab } from "./useAccountWorkspacePanel";
import "./account-dialog.css";
import "./workspace-management.css";

export function AccountWorkspacePanel({
  session,
  hiddenEntries = false,
}: {
  session: AccountSessionContext;
  hiddenEntries?: boolean;
}) {
  const state = useAccountWorkspacePanel(session);
  const { open, tab, setTab, busy, error, notice, me, close } = state;
  const workspaceEntry = useRef<HTMLButtonElement | null>(null);
  const headerControl = useRef<HTMLButtonElement | null>(null);
  const overviewRef = useRef<HTMLDivElement | null>(null);
  const overviewScroll = useRef(new Map<HTMLElement, number>());
  const confirmationOpener = useRef<HTMLElement | null>(null);
  const lastSurface = useRef("");
  const wasConfirming = useRef(false);
  const surface = open === "workspace" ? state.workspaceView : "account";
  const secondary = open === "workspace" && surface !== "overview";
  const rememberOverviewScroll = () => {
    overviewRef.current
      ?.querySelectorAll<HTMLElement>(
        ".workspace-dialog-switcher, .workspace-detail-scroll",
      )
      .forEach((element) => {
        if (element.clientHeight)
          overviewScroll.current.set(element, element.scrollTop);
      });
  };
  const backToWorkspace = () => {
    if (busy) return;
    state.clearMessages();
    state.setWorkspaceView("overview");
  };
  const openManagement = (
    next: WorkspaceManagementTab,
    opener: HTMLButtonElement,
  ) => {
    if (busy) return;
    workspaceEntry.current = opener;
    rememberOverviewScroll();
    state.clearMessages();
    state.setManagementTab(next);
    state.setWorkspaceView("management");
  };
  const openInvitations = (opener: HTMLButtonElement) => {
    if (busy) return;
    workspaceEntry.current = opener;
    rememberOverviewScroll();
    state.clearMessages();
    state.setWorkspaceView("invitations");
  };
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
      confirmationOpener.current = document.activeElement as HTMLElement;
      setConfirming(true);
    } else next();
  };
  const requestClose = () => guard(close);
  const focus = useDrawerFocus(
    () => {
      if (confirming) setConfirming(false);
      else if (secondary) backToWorkspace();
      else requestClose();
    },
    !!open,
    false,
  );
  useLayoutEffect(() => {
    if (!open) {
      lastSurface.current = "";
      wasConfirming.current = false;
      return;
    }
    if (!confirming && wasConfirming.current) {
      if (confirmationOpener.current?.isConnected)
        confirmationOpener.current.focus({ preventScroll: true });
      else headerControl.current?.focus();
    } else if (lastSurface.current && lastSurface.current !== surface) {
      if (surface === "overview" && workspaceEntry.current?.isConnected) {
        workspaceEntry.current.focus({ preventScroll: true });
      } else headerControl.current?.focus();
    }
    lastSurface.current = surface;
    wasConfirming.current = confirming;
  }, [open, surface, confirming]);
  useLayoutEffect(() => {
    if (!open) {
      overviewScroll.current.clear();
      return;
    }
    if (surface !== "overview" || confirming || !overviewScroll.current.size)
      return;
    const pending = new Map(overviewScroll.current);
    const restore = () => {
      pending.forEach((top, element) => {
        if (element.clientHeight) {
          element.scrollTop = top;
          pending.delete(element);
        }
      });
    };
    restore();
    // A column hidden by the mobile tabs is restored once it becomes visible.
    const observer = new ResizeObserver(restore);
    pending.forEach((_, element) => observer.observe(element));
    return () => observer.disconnect();
  }, [open, surface, confirming]);
  const title = confirming
    ? "放弃未保存的更改"
    : open === "account"
      ? "账号设置"
      : surface === "management"
        ? "工作空间管理"
        : surface === "invitations"
          ? "我收到的邀请"
          : "工作空间";
  const subtitle = confirming
    ? "你的修改尚未保存，可以返回继续编辑。"
    : open === "account"
      ? "管理个人资料、登录安全与访问密钥"
      : surface === "management"
        ? me.workspace.name
        : surface === "invitations"
          ? "查看邀请，加入新的工作空间"
          : "切换或管理你的工作空间";
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
                className={`account-dialog ${open === "account" ? "account-dialog-settings" : surface === "management" ? "workspace-management-dialog" : surface === "invitations" ? "workspace-invitations-dialog" : "account-dialog-workspace"}${open === "account" && tab === "keys" ? " account-dialog-settings-keys" : ""}${confirming ? " is-confirming" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={title}
              >
                <header className="account-dialog-heading">
                  {secondary && !confirming ? (
                    <button
                      ref={headerControl}
                      className="workspace-dialog-back"
                      type="button"
                      aria-label="返回工作空间"
                      disabled={busy}
                      onClick={backToWorkspace}
                    >
                      <ArrowLeft size={20} aria-hidden="true" />
                    </button>
                  ) : null}
                  <div className="account-dialog-heading-copy">
                    <h2>
                      {title}
                      {confirming ? "？" : ""}
                    </h2>
                    <p>{subtitle}</p>
                  </div>
                  <button
                    className="icon-button"
                    ref={secondary && !confirming ? undefined : headerControl}
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
                ) : null}
                <div className="account-dialog-view" hidden={confirming}>
                  {error ? (
                    <div className="account-dialog-message danger" role="alert">
                      {error}{" "}
                      <button
                        className="btn small"
                        disabled={busy || state.loading}
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
                    <>
                      <div
                        ref={overviewRef}
                        className="workspace-overview-view"
                        hidden={surface !== "overview"}
                      >
                        <WorkspaceDialogContent
                          state={state}
                          guard={guard}
                          close={requestClose}
                          openManagement={openManagement}
                          openInvitations={openInvitations}
                        />
                      </div>
                      {surface === "management" ? (
                        <WorkspaceManagementDialog state={state} />
                      ) : null}
                      {surface === "invitations" ? (
                        <WorkspaceInvitationsDialog state={state} />
                      ) : null}
                    </>
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
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
