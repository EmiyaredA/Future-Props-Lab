import { useDebouncedValue } from "./useDebouncedValue";
import { ApiError } from "@platform/api/client";
import { workspaceAllows } from "./permissions";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type AccountSessionContext,
  type AccountSession,
  type ApiKey,
  type SecurityEvent,
  type WorkspaceInvitation,
  type WorkspaceItem,
  type WorkspaceMember,
  changePassword as changeAccountPassword,
  createApiKey,
  inviteWorkspaceMember,
  listAccountSessions,
  listApiKeys,
  listMyInvitations,
  listSecurityEvents,
  listWorkspaceInvitations,
  listWorkspaceMembers,
  listWorkspaces,
  putAvatar,
  updateProfile,
  updateWorkspace,
} from "./api";

export function useAccountWorkspacePanel(session: AccountSessionContext) {
  const { me, refresh, logout, switchWorkspace } = session;
  const requestEpoch = useRef(0);
  const [open, setOpen] = useState<"workspace" | "account" | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const [tab, setTab] = useState("overview");
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const debouncedQuery = useDebouncedValue(workspaceQuery);
  const [workspacePage, setWorkspacePage] = useState(1);
  const [workspaceTotal, setWorkspaceTotal] = useState(0);
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "viewer">(
    "member",
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [sentInvitations, setSentInvitations] = useState<WorkspaceInvitation[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [workspaceName, setWorkspaceName] = useState(me.workspace.name);
  const [visibility, setVisibility] = useState(me.workspace.visibility);
  const [inviteUsername, setInviteUsername] = useState("");
  const [displayName, setDisplayName] = useState(me.user.display_name);
  const [email, setEmail] = useState(me.user.email || "");
  const [keyName, setKeyName] = useState("");
  const [keyWrite, setKeyWrite] = useState(false);
  const [revealedKey, setRevealedKey] = useState("");
  const [revealedKeyCopied, setRevealedKeyCopied] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [changedPassword, setChangedPassword] = useState("");
  const [changedPasswordAgain, setChangedPasswordAgain] = useState("");

  const report = async (work: () => Promise<void>, mutation = true) => {
    setError("");
    setNotice("");
    if (mutation) setBusy(true);
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
      if (reason instanceof ApiError && reason.status === 409) {
        await refresh();
        try {
          if (openRef.current === "workspace") {
            if (tab === "members") await loadGovernance();
            else await loadWorkspaces();
          } else if (openRef.current === "account") await loadSecurity();
        } catch {
          /* Keep the original conflict visible; never replay the write. */
        }
      }
    } finally {
      if (mutation) setBusy(false);
    }
  };

  const loadWorkspaces = async () => {
    const epoch = ++requestEpoch.current;
    const [result, pending] = await Promise.all([
      listWorkspaces(debouncedQuery, workspacePage),
      listMyInvitations(),
    ]);
    if (epoch !== requestEpoch.current) return;
    setWorkspaces(result.items);
    setWorkspaceTotal(result.total);
    setInvitations(pending.items);
  };

  const loadGovernance = async () => {
    if (!workspaceAllows(me.workspace, "workspace.manage")) return;
    const epoch = ++requestEpoch.current;
    const [memberResult, invitationResult] = await Promise.all([
      listWorkspaceMembers(),
      listWorkspaceInvitations(),
    ]);
    if (epoch !== requestEpoch.current) return;
    setMembers(memberResult.items);
    setSentInvitations(invitationResult.items);
  };

  const loadSecurity = async () => {
    const [sessionResult, keyResult, eventResult] = await Promise.all([
      listAccountSessions(),
      listApiKeys(),
      listSecurityEvents(),
    ]);
    setSessions(sessionResult.items);
    setKeys(keyResult);
    setSecurityEvents(eventResult.items);
  };

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    void report(async () => {
      if (open === "workspace") {
        await loadWorkspaces();
        if (tab === "members") await loadGovernance();
      } else if (tab !== "profile") {
        await loadSecurity();
      }
    }, false).finally(() => {
      if (current) setLoading(false);
    });
    return () => {
      current = false;
      requestEpoch.current += 1;
    };
    // The panel reloads from the current session snapshot whenever it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, debouncedQuery, workspacePage]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      await updateProfile(displayName, email || null, me.user.revision);
      await refresh();
      setNotice("个人资料已保存。");
    });
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    await report(async () => {
      await putAvatar(file, me.user.revision);
      await refresh();
      setNotice("头像已更新。");
    });
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (changedPassword !== changedPasswordAgain) {
      setError("两次输入的新密码不一致");
      return;
    }
    await report(async () => {
      await changeAccountPassword(currentPassword, changedPassword);
      setCurrentPassword("");
      setChangedPassword("");
      setChangedPasswordAgain("");
      await refresh();
      await loadSecurity();
      setNotice("密码已修改，其他设备已退出。");
    });
  };

  const saveWorkspace = async () => {
    await report(async () => {
      await updateWorkspace(workspaceName, visibility, me.workspace.revision);
      await refresh();
      setNotice("工作区设置已保存。");
    });
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      await inviteWorkspaceMember(inviteUsername, inviteRole);
      setInviteUsername("");
      await loadGovernance();
      setNotice("邀请已创建。");
    });
  };

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      const result = await createApiKey(
        keyName,
        keyWrite && workspaceAllows(me.workspace, "content.write")
          ? ["studio:read", "studio:write"]
          : ["studio:read"],
      );
      setKeyName("");
      if (openRef.current !== "account" || tabRef.current !== "keys") return;
      setRevealedKey(result.secret);
      setRevealedKeyCopied(false);
      await loadSecurity();
    });
  };

  const copyRevealedKey = async () => {
    if (!revealedKey) return;
    await report(async () => {
      await navigator.clipboard.writeText(revealedKey);
      setRevealedKeyCopied(true);
      setNotice("Management API Key 已复制。");
    });
  };

  const close = () => {
    openRef.current = null;
    setOpen(null);
    setError("");
    setNotice("");
    setRevealedKey("");
    setRevealedKeyCopied(false);
    setCurrentPassword("");
    setChangedPassword("");
    setChangedPasswordAgain("");
    setWorkspaceName(me.workspace.name);
    setVisibility(me.workspace.visibility);
    setDisplayName(me.user.display_name);
    setEmail(me.user.email || "");
  };

  useEffect(() => {
    const showAccount = () => {
      setTab("profile");
      setOpen("account");
    };
    const show = () => {
      setTab("overview");
      setOpen("workspace");
    };
    window.addEventListener("future-props:open-workspace", show);
    window.addEventListener("future-props:open-account", showAccount);
    return () => {
      window.removeEventListener("future-props:open-workspace", show);
      window.removeEventListener("future-props:open-account", showAccount);
    };
  }, []);
  return {
    loading,
    reload: () =>
      report(async () => {
        if (open === "workspace") {
          await loadWorkspaces();
          if (tab === "members") await loadGovernance();
        } else await loadSecurity();
      }, false),
    busy,
    visibility,
    setVisibility,
    sentInvitations,
    clearSecret: () => {
      setRevealedKey("");
      setRevealedKeyCopied(false);
    },
    workspaceQuery,
    setWorkspaceQuery,
    workspacePage,
    setWorkspacePage,
    workspaceTotal,
    inviteRole,
    setInviteRole,
    me,
    refresh,
    logout,
    switchWorkspace,
    open,
    setOpen,
    tab,
    setTab,
    error,
    notice,
    workspaces,
    members,
    invitations,
    sessions,
    keys,
    securityEvents,
    workspaceName,
    setWorkspaceName,
    inviteUsername,
    setInviteUsername,
    displayName,
    setDisplayName,
    email,
    setEmail,
    keyName,
    setKeyName,
    keyWrite,
    setKeyWrite,
    revealedKey,
    revealedKeyCopied,
    currentPassword,
    setCurrentPassword,
    changedPassword,
    setChangedPassword,
    changedPasswordAgain,
    setChangedPasswordAgain,
    report,
    loadWorkspaces,
    loadGovernance,
    loadSecurity,
    saveProfile,
    uploadAvatar,
    changePassword,
    saveWorkspace,
    invite,
    createKey,
    copyRevealedKey,
    close,
  };
}
