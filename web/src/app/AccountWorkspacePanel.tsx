import { type FormEvent, useEffect, useState } from "react";
import {
  sessionRequest,
  type SessionContextValue,
  type SessionWorkspace,
  useOptionalStudioSession,
} from "@app/StudioSession";

type WorkspaceItem = SessionWorkspace & {
  owner_username: string;
  owner_display_name: string;
};
type WorkspaceList = { items: WorkspaceItem[]; total: number };
type Member = {
  membership_id: string;
  username: string;
  display_name: string;
  role: "owner" | "member";
  revision: number;
};
type Invitation = {
  id: string;
  workspace_name: string;
  invitee_username: string;
  status: string;
  revision: number;
  expires_at: string;
};
type AccountSession = {
  id: string;
  client_ip: string;
  user_agent: string;
  last_seen_at: string;
  is_current: boolean;
};
type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  revision: number;
};
type ManagedAccount = {
  id: string;
  username: string;
  display_name: string;
  status: "active" | "disabled";
  must_change_password: boolean;
  revision: number;
};
type SecurityEvent = {
  id: string;
  event_type: string;
  outcome: string;
  client_ip: string;
  created_at: string;
};

function shortDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AccountWorkspacePanel() {
  const session = useOptionalStudioSession();
  if (!session) return null;
  return <AccountWorkspacePanelContent session={session} />;
}

function AccountWorkspacePanelContent({
  session,
}: {
  session: SessionContextValue;
}) {
  const { me, refresh, logout, switchWorkspace } = session;
  const [open, setOpen] = useState<"workspace" | "account" | null>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [workspaceName, setWorkspaceName] = useState(me.workspace.name);
  const [inviteUsername, setInviteUsername] = useState("");
  const [displayName, setDisplayName] = useState(me.user.display_name);
  const [email, setEmail] = useState(me.user.email || "");
  const [reauthPassword, setReauthPassword] = useState("");
  const [keyName, setKeyName] = useState("");
  const [keyWrite, setKeyWrite] = useState(false);
  const [revealedKey, setRevealedKey] = useState("");
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
    const result = await sessionRequest<WorkspaceList>(
      "/v1/account/workspaces",
    );
    setWorkspaces(result.items);
    const pending = await sessionRequest<{ items: Invitation[] }>(
      "/v1/account/workspace-invitations",
    );
    setInvitations(pending.items);
  };

  const loadGovernance = async () => {
    if (!["owner", "platform_admin"].includes(me.workspace.access_kind)) return;
    const [memberResult, invitationResult] = await Promise.all([
      sessionRequest<{ items: Member[] }>(
        "/v1/account/workspaces/current/members",
      ),
      sessionRequest<{ items: Invitation[] }>(
        "/v1/account/workspaces/current/invitations",
      ),
    ]);
    setMembers(memberResult.items);
    setInvitations(invitationResult.items);
  };

  const loadSecurity = async () => {
    const [sessionResult, keyResult, eventResult] = await Promise.all([
      sessionRequest<{ items: AccountSession[] }>("/v1/account/sessions"),
      sessionRequest<ApiKey[]>("/v1/account/api-keys"),
      sessionRequest<{ items: SecurityEvent[] }>("/v1/account/security-events"),
    ]);
    setSessions(sessionResult.items);
    setKeys(keyResult);
    setSecurityEvents(eventResult.items);
  };

  const loadAccounts = async () => {
    if (!me.user.is_platform_admin) return;
    const result = await sessionRequest<{ items: ManagedAccount[] }>(
      "/v1/platform/accounts",
    );
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

  const reauthenticate = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      await sessionRequest("/v1/auth/reauth", {
        method: "POST",
        body: JSON.stringify({ password: reauthPassword }),
      });
      setReauthPassword("");
      setNotice("身份已重新验证，敏感操作将在 10 分钟内保持解锁。");
    });
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      await sessionRequest("/v1/account/profile", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName,
          email: email || null,
          expected_revision: me.user.revision,
        }),
      });
      await refresh();
      setNotice("个人资料已保存。");
    });
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    await report(async () => {
      const form = new FormData();
      form.append("file", file);
      form.append("expected_revision", String(me.user.revision));
      await sessionRequest("/v1/account/profile/avatar", {
        method: "PUT",
        body: form,
      });
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
      await sessionRequest("/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: changedPassword,
        }),
      });
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
      await sessionRequest("/v1/account/workspaces/current", {
        method: "PATCH",
        body: JSON.stringify({
          name: workspaceName,
          visibility,
          expected_revision: me.workspace.revision,
        }),
      });
      await refresh();
      setNotice("Workspace 设置已保存。");
    });
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      await sessionRequest("/v1/account/workspaces/current/invitations", {
        method: "POST",
        body: JSON.stringify({ username: inviteUsername }),
      });
      setInviteUsername("");
      await loadGovernance();
      setNotice("邀请已创建。");
    });
  };

  const createKey = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      const result = await sessionRequest<{ secret: string }>(
        "/v1/account/api-keys",
        {
          method: "POST",
          body: JSON.stringify({
            name: keyName,
            scopes: keyWrite
              ? ["studio:read", "studio:write"]
              : ["studio:read"],
            expires_in_days: 90,
          }),
        },
      );
      setKeyName("");
      setRevealedKey(result.secret);
      await loadSecurity();
    });
  };

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    await report(async () => {
      const result = await sessionRequest<{ temporary_password: string }>(
        "/v1/platform/accounts",
        {
          method: "POST",
          body: JSON.stringify({
            username: newUsername,
            display_name: newDisplayName,
          }),
        },
      );
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
    setTemporaryPassword("");
  };

  return (
    <>
      <div className="sidebar-session-cards">
        <button
          type="button"
          className="sidebar-session-card"
          onClick={() => {
            setTab("overview");
            setOpen("workspace");
          }}
        >
          <small>当前 Workspace</small>
          <strong>{me.workspace.name}</strong>
          <span>
            {me.workspace.access_kind === "public_viewer"
              ? "公开展台"
              : me.workspace.role || "平台管理"}
          </span>
        </button>
        <button
          type="button"
          className="sidebar-session-card account"
          onClick={() => {
            setTab("profile");
            setOpen("account");
          }}
        >
          <span className="account-avatar">
            {me.user.display_name.slice(0, 1)}
          </span>
          <span>
            <strong>{me.user.display_name}</strong>
            <small>@{me.user.username}</small>
          </span>
        </button>
      </div>

      {open ? (
        <div
          className="modal-backdrop account-modal-backdrop"
          role="presentation"
          onMouseDown={close}
        >
          <section
            className="modal-card account-modal"
            role="dialog"
            aria-modal="true"
            aria-label={open === "workspace" ? "Workspace 管理" : "账号中心"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="account-modal-head">
              <div>
                <small>{open === "workspace" ? "WORKSPACE" : "ACCOUNT"}</small>
                <h2>
                  {open === "workspace"
                    ? me.workspace.name
                    : me.user.display_name}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭"
                onClick={close}
              >
                ×
              </button>
            </header>
            <div className="account-tabs" role="tablist">
              {(open === "workspace"
                ? [
                    ["overview", "空间"],
                    ...(["owner", "platform_admin"].includes(
                      me.workspace.access_kind,
                    )
                      ? [["members", "成员与邀请"]]
                      : []),
                  ]
                : [
                    ["profile", "资料"],
                    ["security", "安全与密钥"],
                    ...(me.user.is_platform_admin
                      ? [["accounts", "账号治理"]]
                      : []),
                  ]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  className={tab === value ? "active" : ""}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {error ? <div className="inline-alert danger">{error}</div> : null}
            {notice ? (
              <div className="inline-alert success">{notice}</div>
            ) : null}

            <div className="account-modal-body">
              {open === "workspace" && tab === "overview" ? (
                <>
                  <section className="settings-section">
                    <h3>可访问的空间</h3>
                    <div className="settings-list">
                      {workspaces.map((workspace) => (
                        <div className="settings-row" key={workspace.id}>
                          <span>
                            <strong>{workspace.name}</strong>
                            <small>
                              {workspace.owner_display_name} ·{" "}
                              {workspace.visibility === "public"
                                ? "公开"
                                : "私有"}
                            </small>
                          </span>
                          {workspace.id === me.workspace.id ? (
                            <em>当前</em>
                          ) : (
                            <button
                              type="button"
                              className="btn small"
                              onClick={() =>
                                void report(() => switchWorkspace(workspace.id))
                              }
                            >
                              切换
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                  {["owner", "platform_admin"].includes(
                    me.workspace.access_kind,
                  ) ? (
                    <section className="settings-section">
                      <h3>空间设置</h3>
                      <label>
                        <span>名称</span>
                        <input
                          value={workspaceName}
                          onChange={(event) =>
                            setWorkspaceName(event.target.value)
                          }
                        />
                      </label>
                      <div className="button-row">
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => void saveWorkspace()}
                        >
                          保存名称
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            void saveWorkspace(
                              me.workspace.visibility === "public"
                                ? "private"
                                : "public",
                            )
                          }
                        >
                          {me.workspace.visibility === "public"
                            ? "设为私有"
                            : "开启公开展台"}
                        </button>
                      </div>
                    </section>
                  ) : null}
                  <section className="settings-section">
                    <h3>待处理邀请</h3>
                    {invitations.filter((item) => item.status === "pending")
                      .length ? (
                      invitations
                        .filter((item) => item.status === "pending")
                        .map((item) => (
                          <div className="settings-row" key={item.id}>
                            <span>
                              <strong>{item.workspace_name}</strong>
                              <small>
                                有效期至 {shortDate(item.expires_at)}
                              </small>
                            </span>
                            <div className="button-row">
                              <button
                                type="button"
                                className="btn small primary"
                                onClick={() =>
                                  void report(async () => {
                                    await sessionRequest(
                                      `/v1/account/workspace-invitations/${item.id}/accept`,
                                      {
                                        method: "POST",
                                        body: JSON.stringify({
                                          expected_revision: item.revision,
                                        }),
                                      },
                                    );
                                    await loadWorkspaces();
                                  })
                                }
                              >
                                接受
                              </button>
                              <button
                                type="button"
                                className="btn small"
                                onClick={() =>
                                  void report(async () => {
                                    await sessionRequest(
                                      `/v1/account/workspace-invitations/${item.id}/decline`,
                                      {
                                        method: "POST",
                                        body: JSON.stringify({
                                          expected_revision: item.revision,
                                        }),
                                      },
                                    );
                                    await loadWorkspaces();
                                  })
                                }
                              >
                                拒绝
                              </button>
                            </div>
                          </div>
                        ))
                    ) : (
                      <p className="empty-copy">没有待处理邀请。</p>
                    )}
                  </section>
                </>
              ) : null}

              {open === "workspace" && tab === "members" ? (
                <>
                  <section className="settings-section">
                    <h3>成员</h3>
                    {members.map((member) => (
                      <div className="settings-row" key={member.membership_id}>
                        <span>
                          <strong>{member.display_name}</strong>
                          <small>
                            @{member.username} · {member.role}
                          </small>
                        </span>
                        {member.role === "member" ? (
                          <button
                            type="button"
                            className="btn small danger"
                            onClick={() =>
                              void report(async () => {
                                await sessionRequest(
                                  `/v1/account/workspaces/current/members/${member.membership_id}`,
                                  {
                                    method: "DELETE",
                                    body: JSON.stringify({
                                      expected_revision: member.revision,
                                    }),
                                  },
                                );
                                await loadGovernance();
                              })
                            }
                          >
                            移除
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </section>
                  <form
                    className="settings-section"
                    onSubmit={(event) => void invite(event)}
                  >
                    <h3>邀请已有账号</h3>
                    <label>
                      <span>用户名</span>
                      <input
                        value={inviteUsername}
                        onChange={(event) =>
                          setInviteUsername(event.target.value)
                        }
                      />
                    </label>
                    <button className="btn primary" disabled={!inviteUsername}>
                      发送邀请
                    </button>
                    {invitations
                      .filter((item) => item.status === "pending")
                      .map((item) => (
                        <div className="settings-row" key={item.id}>
                          <span>
                            <strong>@{item.invitee_username}</strong>
                            <small>
                              等待接受 · {shortDate(item.expires_at)} 到期
                            </small>
                          </span>
                          <button
                            type="button"
                            className="btn small danger"
                            onClick={() =>
                              void report(async () => {
                                await sessionRequest(
                                  `/v1/account/workspaces/current/invitations/${item.id}`,
                                  {
                                    method: "DELETE",
                                    body: JSON.stringify({
                                      expected_revision: item.revision,
                                    }),
                                  },
                                );
                                await loadGovernance();
                              })
                            }
                          >
                            撤销
                          </button>
                        </div>
                      ))}
                  </form>
                </>
              ) : null}

              {open === "account" && tab === "profile" ? (
                <form
                  className="settings-section"
                  onSubmit={(event) => void saveProfile(event)}
                >
                  <h3>个人资料</h3>
                  <div className="profile-avatar-editor">
                    {me.user.avatar_url ? (
                      <img src={me.user.avatar_url} alt="当前头像" />
                    ) : (
                      <span className="account-avatar">
                        {me.user.display_name.slice(0, 1)}
                      </span>
                    )}
                    <label className="btn small">
                      上传头像
                      <input
                        className="visually-hidden"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) =>
                          void uploadAvatar(event.target.files?.[0])
                        }
                      />
                    </label>
                    {me.user.avatar_url ? (
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={() =>
                          void report(async () => {
                            await sessionRequest("/v1/account/profile/avatar", {
                              method: "DELETE",
                              body: JSON.stringify({
                                expected_revision: me.user.revision,
                              }),
                            });
                            await refresh();
                          })
                        }
                      >
                        删除头像
                      </button>
                    ) : null}
                  </div>
                  <label>
                    <span>用户名</span>
                    <input value={me.user.username} disabled />
                  </label>
                  <label>
                    <span>显示名称</span>
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>邮箱</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <button className="btn primary">保存资料</button>
                </form>
              ) : null}

              {open === "account" && tab === "security" ? (
                <>
                  <form
                    className="settings-section"
                    onSubmit={(event) => void changePassword(event)}
                  >
                    <h3>修改密码</h3>
                    <label>
                      <span>当前密码</span>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(event) =>
                          setCurrentPassword(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      <span>新密码</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={changedPassword}
                        onChange={(event) =>
                          setChangedPassword(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      <span>再次输入新密码</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={changedPasswordAgain}
                        onChange={(event) =>
                          setChangedPasswordAgain(event.target.value)
                        }
                      />
                    </label>
                    <button
                      className="btn primary"
                      disabled={
                        !currentPassword ||
                        !changedPassword ||
                        !changedPasswordAgain
                      }
                    >
                      修改密码
                    </button>
                  </form>
                  <form
                    className="settings-section"
                    onSubmit={(event) => void reauthenticate(event)}
                  >
                    <h3>敏感操作解锁</h3>
                    <p>创建密钥、管理成员或账号前，请重新验证密码。</p>
                    <label>
                      <span>当前密码</span>
                      <input
                        type="password"
                        value={reauthPassword}
                        onChange={(event) =>
                          setReauthPassword(event.target.value)
                        }
                      />
                    </label>
                    <button className="btn" disabled={!reauthPassword}>
                      重新验证
                    </button>
                  </form>
                  <section className="settings-section">
                    <h3>活动会话</h3>
                    {sessions.map((item) => (
                      <div className="settings-row" key={item.id}>
                        <span>
                          <strong>
                            {item.is_current
                              ? "当前设备"
                              : item.user_agent || "未知设备"}
                          </strong>
                          <small>
                            {item.client_ip} · {shortDate(item.last_seen_at)}
                          </small>
                        </span>
                        {!item.is_current ? (
                          <button
                            type="button"
                            className="btn small"
                            onClick={() =>
                              void report(async () => {
                                await sessionRequest(
                                  `/v1/account/sessions/${item.id}`,
                                  { method: "DELETE" },
                                );
                                await loadSecurity();
                              })
                            }
                          >
                            撤销
                          </button>
                        ) : null}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        void report(async () => {
                          await sessionRequest(
                            "/v1/account/sessions/revoke-others",
                            { method: "POST" },
                          );
                          await loadSecurity();
                        })
                      }
                    >
                      撤销其他设备
                    </button>
                  </section>
                  <form
                    className="settings-section"
                    onSubmit={(event) => void createKey(event)}
                  >
                    <h3>Management API Key</h3>
                    {revealedKey ? (
                      <div className="secret-once">
                        <strong>请立即复制，只显示这一次</strong>
                        <code>{revealedKey}</code>
                      </div>
                    ) : null}
                    <label>
                      <span>密钥名称</span>
                      <input
                        value={keyName}
                        onChange={(event) => setKeyName(event.target.value)}
                      />
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={keyWrite}
                        onChange={(event) => setKeyWrite(event.target.checked)}
                      />
                      <span>允许写入当前 Workspace</span>
                    </label>
                    <button className="btn primary" disabled={!keyName}>
                      创建 90 天密钥
                    </button>
                    {keys.map((key) => (
                      <div className="settings-row" key={key.id}>
                        <span>
                          <strong>{key.name}</strong>
                          <small>
                            {key.key_prefix}… · {key.scopes.join(", ")} ·{" "}
                            {key.revoked_at
                              ? "已撤销"
                              : `到期 ${shortDate(key.expires_at)}`}
                          </small>
                        </span>
                        {!key.revoked_at ? (
                          <button
                            type="button"
                            className="btn small danger"
                            onClick={() =>
                              void report(async () => {
                                await sessionRequest(
                                  `/v1/account/api-keys/${key.id}/revoke`,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({
                                      expected_revision: key.revision,
                                    }),
                                  },
                                );
                                await loadSecurity();
                              })
                            }
                          >
                            撤销
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </form>
                  <section className="settings-section">
                    <h3>本人安全事件</h3>
                    {securityEvents.slice(0, 20).map((item) => (
                      <div className="settings-row" key={item.id}>
                        <span>
                          <strong>{item.event_type}</strong>
                          <small>
                            {item.outcome} · {item.client_ip || "本机"} ·{" "}
                            {shortDate(item.created_at)}
                          </small>
                        </span>
                      </div>
                    ))}
                  </section>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => void report(logout)}
                  >
                    退出登录
                  </button>
                </>
              ) : null}

              {open === "account" && tab === "accounts" ? (
                <>
                  <form
                    className="settings-section"
                    onSubmit={(event) => void createAccount(event)}
                  >
                    <h3>创建普通账号</h3>
                    {temporaryPassword ? (
                      <div className="secret-once">
                        <strong>临时密码只显示一次</strong>
                        <code>{temporaryPassword}</code>
                      </div>
                    ) : null}
                    <label>
                      <span>用户名</span>
                      <input
                        value={newUsername}
                        onChange={(event) => setNewUsername(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>显示名称</span>
                      <input
                        value={newDisplayName}
                        onChange={(event) =>
                          setNewDisplayName(event.target.value)
                        }
                      />
                    </label>
                    <button className="btn primary" disabled={!newUsername}>
                      创建账号
                    </button>
                  </form>
                  <section className="settings-section">
                    <h3>账号列表</h3>
                    {accounts.map((account) => (
                      <div className="settings-row" key={account.id}>
                        <span>
                          <strong>{account.display_name}</strong>
                          <small>
                            @{account.username} ·{" "}
                            {account.status === "active" ? "正常" : "已停用"}
                            {account.must_change_password ? " · 待改密" : ""}
                          </small>
                        </span>
                        {account.id !== me.user.id ? (
                          <button
                            type="button"
                            className="btn small"
                            onClick={() =>
                              void report(async () => {
                                await sessionRequest(
                                  `/v1/platform/accounts/${account.id}`,
                                  {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      status:
                                        account.status === "active"
                                          ? "disabled"
                                          : "active",
                                      expected_revision: account.revision,
                                    }),
                                  },
                                );
                                await loadAccounts();
                              })
                            }
                          >
                            {account.status === "active" ? "停用" : "启用"}
                          </button>
                        ) : null}
                        {account.id !== me.user.id ? (
                          <button
                            type="button"
                            className="btn small"
                            onClick={() =>
                              void report(async () => {
                                const result = await sessionRequest<{
                                  temporary_password: string;
                                }>(
                                  `/v1/platform/accounts/${account.id}/reset-password`,
                                  { method: "POST" },
                                );
                                setTemporaryPassword(result.temporary_password);
                                await loadAccounts();
                              })
                            }
                          >
                            重置密码
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </section>
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
