import { deleteAccountSession, deleteAvatar, revokeOtherSessions } from "./api";
import { formatAccountDate as shortDate } from "./formatAccountDate";
import { avatarSrc } from "./avatarSrc";
import type { useAccountPanel } from "./useAccountPanel";
import { auditLabels } from "./auditLabels";
import { useRef } from "react";
import { Upload } from "lucide-react";
import { ApiKeysSettings } from "./ApiKeysSettings";
import "./account-profile.css";
export function AccountSettingsContent({
  state,
}: {
  state: ReturnType<typeof useAccountPanel>;
}) {
  const avatarInput = useRef<HTMLInputElement>(null);
  const {
    me,
    refresh,
    tab,
    report,
    loadSecurity,
    saveProfile,
    uploadAvatar,
    displayName,
    setDisplayName,
    email,
    setEmail,
    changePassword,
    currentPassword,
    setCurrentPassword,
    changedPassword,
    setChangedPassword,
    changedPasswordAgain,
    setChangedPasswordAgain,
    sessions,
    securityEvents,
  } = state;
  const profileAvatar = avatarSrc(me.user.avatar_url, me.user.revision);
  return (
    <>
      {tab === "profile" ? (
        <form
          className="account-profile-form"
          onSubmit={(e) => void saveProfile(e)}
        >
          <div className="account-profile-heading">
            <h3>个人资料</h3>
            <p>设置头像与显示名称，让协作中的身份更清晰。</p>
          </div>
          <div className="account-profile-row account-profile-avatar-row">
            <span className="account-profile-label">头像</span>
            <div className="account-profile-avatar-editor">
              {profileAvatar ? (
                <img src={profileAvatar} alt="当前头像" />
              ) : (
                <span className="account-identity-avatar">
                  {me.user.display_name.slice(0, 1)}
                </span>
              )}
              <div className="account-profile-avatar-controls">
                <div className="account-profile-avatar-actions">
                  <button
                    type="button"
                    className="btn small"
                    disabled={state.busy}
                    onClick={() => avatarInput.current?.click()}
                  >
                    <Upload size={15} aria-hidden />
                    上传头像
                  </button>
                  <input
                    ref={avatarInput}
                    hidden
                    aria-label="上传头像文件"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      void uploadAvatar(file);
                    }}
                  />
                  {me.user.avatar_url ? (
                    <button
                      className="btn small danger"
                      type="button"
                      disabled={state.busy}
                      onClick={() =>
                        void report(async () => {
                          await deleteAvatar(me.user.revision);
                          await refresh();
                        })
                      }
                    >
                      删除头像
                    </button>
                  ) : null}
                </div>
                <small>支持 PNG、JPG 或 WebP 图片</small>
              </div>
            </div>
          </div>
          <label className="account-profile-row">
            <span className="account-profile-label">用户名</span>
            <span className="account-profile-field">
              <input value={me.user.username} disabled />
              <small>用于登录和成员邀请，创建后不可修改</small>
            </span>
          </label>
          <label className="account-profile-row">
            <span className="account-profile-label">显示名称</span>
            <span className="account-profile-field">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </span>
          </label>
          <label className="account-profile-row">
            <span className="account-profile-label">邮箱</span>
            <span className="account-profile-field">
              <input
                type="email"
                placeholder="填写联系邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </span>
          </label>
          <footer className="account-profile-footer">
            <button className="btn primary" disabled={state.busy}>
              {state.busy ? "正在保存…" : "保存资料"}
            </button>
          </footer>
        </form>
      ) : null}
      {tab === "security" ? (
        <>
          {" "}
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
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span>新密码</span>
              <input
                type="password"
                autoComplete="new-password"
                value={changedPassword}
                onChange={(event) => setChangedPassword(event.target.value)}
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
                state.busy ||
                !currentPassword ||
                !changedPassword ||
                !changedPasswordAgain
              }
            >
              修改密码
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
                        await deleteAccountSession(item.id);
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
                  await revokeOtherSessions();
                  await loadSecurity();
                })
              }
            >
              撤销其他设备
            </button>
          </section>
        </>
      ) : null}
      {tab === "keys" ? (
        <>
          <ApiKeysSettings state={state} />
        </>
      ) : null}
      {tab === "events" ? (
        <section className="settings-section">
          <h3>本人安全事件</h3>
          {securityEvents.slice(0, 20).map((item) => (
            <div className="settings-row" key={item.id}>
              <span>
                <strong>{auditLabels[item.event_type] || "安全事件"}</strong>
                <small>
                  {item.outcome === "success" ? "成功" : "失败"} ·{" "}
                  {item.client_ip || "本机"} · {shortDate(item.created_at)}
                </small>
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
