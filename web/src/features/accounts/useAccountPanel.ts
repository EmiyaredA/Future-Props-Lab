import { ApiError } from "@platform/api/client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type AccountSessionContext,
  type AccountSession,
  type ApiKey,
  type SecurityEvent,
  changePassword as changeAccountPassword,
  createApiKey,
  listAccountSessions,
  listApiKeys,
  listSecurityEvents,
  putAvatar,
  updateProfile,
} from "./api";

export function useAccountPanel(session: AccountSessionContext) {
  const { me, refresh, logout } = session;
  const requestEpoch = useRef(0);
  const [open, setOpen] = useState<"account" | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const [tab, setTab] = useState("profile");
  const requestScope = useRef("");
  requestScope.current = `${open}:${tab}`;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [displayName, setDisplayName] = useState(me.user.display_name);
  const [email, setEmail] = useState(me.user.email || "");
  const [keyName, setKeyName] = useState("");
  const [keyWrite, setKeyWrite] = useState(false);
  const [keyDuration, setKeyDuration] = useState("90");
  const [revealedKey, setRevealedKey] = useState("");
  const [revealedKeyCopied, setRevealedKeyCopied] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [changedPassword, setChangedPassword] = useState("");
  const [changedPasswordAgain, setChangedPasswordAgain] = useState("");

  const report = async (work: () => Promise<void>, mutation = true) => {
    const scope = requestScope.current;
    let epoch = requestEpoch.current;
    setError("");
    setNotice("");
    if (mutation) setBusy(true);
    try {
      const result = work();
      epoch = requestEpoch.current;
      await result;
    } catch (reason) {
      if (
        scope !== requestScope.current ||
        !openRef.current ||
        (!mutation && epoch !== requestEpoch.current)
      )
        return;
      setError(reason instanceof Error ? reason.message : "操作失败");
      if (reason instanceof ApiError && reason.status === 409) {
        await refresh();
        try {
          if (openRef.current === "account") await loadSecurity();
        } catch {
          /* Keep the original conflict visible; never replay the write. */
        }
      }
    } finally {
      if (mutation) setBusy(false);
    }
  };

  const loadSecurity = async () => {
    const epoch = ++requestEpoch.current;
    const [sessionResult, keyResult, eventResult] = await Promise.all([
      listAccountSessions(),
      listApiKeys(),
      listSecurityEvents(),
    ]);
    if (epoch !== requestEpoch.current) return;
    setSessions(sessionResult.items);
    setKeys(keyResult);
    setSecurityEvents(eventResult.items);
  };

  const reload = async () => {
    setLoading(true);
    await report(loadSecurity, false);
    setLoading(false);
  };
  useEffect(() => {
    if (!open || tab === "profile") return;
    let current = true;
    setLoading(true);
    void report(loadSecurity, false).finally(() => {
      if (current) setLoading(false);
    });
    return () => {
      current = false;
      requestEpoch.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

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

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      const result = await createApiKey(
        keyName,
        keyWrite && me.permission_keys?.includes("content.write")
          ? ["studio:read", "studio:write"]
          : ["studio:read"],
        Number(keyDuration),
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
    requestEpoch.current += 1;
    setError("");
    setNotice("");
    setRevealedKey("");
    setRevealedKeyCopied(false);
    setCurrentPassword("");
    setChangedPassword("");
    setChangedPasswordAgain("");
    setDisplayName(me.user.display_name);
    setEmail(me.user.email || "");
  };

  useEffect(() => {
    const showAccount = () => {
      setTab("profile");
      setOpen("account");
    };
    window.addEventListener("future-props:open-account", showAccount);
    return () => {
      window.removeEventListener("future-props:open-account", showAccount);
    };
  }, []);
  return {
    loading,
    reload,
    busy,
    me,
    refresh,
    logout,
    open,
    setOpen,
    tab,
    setTab,
    error,
    notice,
    sessions,
    keys,
    securityEvents,
    displayName,
    setDisplayName,
    email,
    setEmail,
    keyName,
    setKeyName,
    keyWrite,
    setKeyWrite,
    keyDuration,
    setKeyDuration,
    revealedKey,
    revealedKeyCopied,
    currentPassword,
    setCurrentPassword,
    changedPassword,
    setChangedPassword,
    changedPasswordAgain,
    setChangedPasswordAgain,
    report,
    loadSecurity,
    saveProfile,
    uploadAvatar,
    changePassword,
    createKey,
    copyRevealedKey,
    close,
    clearSecret: () => {
      setRevealedKey("");
      setRevealedKeyCopied(false);
    },
    clearMessages: () => {
      setError("");
      setNotice("");
    },
  };
}
