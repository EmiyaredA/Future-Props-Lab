import { type FormEvent, useEffect, useState } from "react";
import {
  type AccountSessionContext,
  type AccountSession,
  type ApiKey,
  type ManagedAccount,
  type SecurityEvent,
  type WorkspaceInvitation,
  type WorkspaceItem,
  type WorkspaceMember,
  changePassword as changeAccountPassword,
  createApiKey,
  createPlatformAccount,
  inviteWorkspaceMember,
  listAccountSessions,
  listApiKeys,
  listMyInvitations,
  listPlatformAccounts,
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
  const [open, setOpen] = useState<"workspace" | "account" | null>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [workspaceName, setWorkspaceName] = useState(me.workspace.name);
  const [inviteUsername, setInviteUsername] = useState("");
  const [displayName, setDisplayName] = useState(me.user.display_name);
  const [email, setEmail] = useState(me.user.email || "");
  const [keyName, setKeyName] = useState("");
  const [keyWrite, setKeyWrite] = useState(false);
  const [revealedKey, setRevealedKey] = useState("");
  const [revealedKeyCopied, setRevealedKeyCopied] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [changedPassword, setChangedPassword] = useState("");
  const [changedPasswordAgain, setChangedPasswordAgain] = useState("");

  const report = async (work: () => Promise<void>) => {
    setError("");
    setNotice("");
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    }
  };

  const loadWorkspaces = async () => {
    const [result, pending] = await Promise.all([
      listWorkspaces(),
      listMyInvitations(),
    ]);
    setWorkspaces(result.items);
    setInvitations(pending.items);
  };

  const loadGovernance = async () => {
    if (!["owner", "platform_admin"].includes(me.workspace.access_kind)) return;
    const [memberResult, invitationResult] = await Promise.all([
      listWorkspaceMembers(),
      listWorkspaceInvitations(),
    ]);
    setMembers(memberResult.items);
    setInvitations(invitationResult.items);
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

  const loadAccounts = async () => {
    if (!me.user.is_platform_admin) return;
    const result = await listPlatformAccounts();
    setAccounts(result.items);
  };

  useEffect(() => {
    if (!open) return;
    void report(async () => {
      if (open === "workspace") {
        await loadWorkspaces();
        await loadGovernance();
      } else {
        await loadSecurity();
        await loadAccounts();
      }
    });
    // The panel reloads from the current session snapshot whenever it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const saveWorkspace = async (visibility = me.workspace.visibility) => {
    await report(async () => {
      await updateWorkspace(workspaceName, visibility, me.workspace.revision);
      await refresh();
      setNotice("Workspace 设置已保存。");
    });
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      await inviteWorkspaceMember(inviteUsername);
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
        keyWrite ? ["studio:read", "studio:write"] : ["studio:read"],
      );
      setKeyName("");
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

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      const result = await createPlatformAccount(newUsername, newDisplayName);
      setTemporaryPassword(result.temporary_password);
      setNewUsername("");
      setNewDisplayName("");
      await loadAccounts();
    });
  };

  const close = () => {
    setOpen(null);
    setError("");
    setNotice("");
    setRevealedKey("");
    setRevealedKeyCopied(false);
    setTemporaryPassword("");
  };

  return {
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
    accounts,
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
    newUsername,
    setNewUsername,
    newDisplayName,
    setNewDisplayName,
    temporaryPassword,
    setTemporaryPassword,
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
    loadAccounts,
    saveProfile,
    uploadAvatar,
    changePassword,
    saveWorkspace,
    invite,
    createKey,
    copyRevealedKey,
    createAccount,
    close,
  };
}
