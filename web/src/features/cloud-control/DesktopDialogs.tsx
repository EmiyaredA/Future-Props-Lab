import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Eye,
  EyeOff,
  Lock,
  Monitor,
  SlidersHorizontal,
  Timer,
} from "lucide-react";
import { saveIdle } from "./cloudApi";
import "./desktop-idle.css";

export function DesktopPassword({
  locked,
  minutes,
  focus,
  error,
  submit,
  close,
}: {
  locked: boolean;
  minutes: number;
  focus: boolean;
  error: string;
  submit: (password: string) => void;
  close: () => void;
}) {
  const title = useId();
  const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus) passwordInput.current?.focus();
  }, [focus]);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  return (
    <section
      className="cloud-desktop-dialog"
      role="dialog"
      aria-labelledby={title}
    >
      <header>
        {locked ? <Lock size={26} /> : <Monitor size={26} />}
        <h3 id={title}>{locked ? "远程桌面已锁定" : "连接 Mac"}</h3>
        <p>
          {locked
            ? `已闲置 ${minutes} 分钟。输入 VNC 密码重新连接。`
            : "输入 Mac 屏幕共享的 VNC 密码。"}
        </p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!password) return;
          submit(password);
          setPassword("");
        }}
      >
        <label htmlFor={`${title}-password`}>VNC 密码</label>
        <div className="cloud-password-field">
          <input
            id={`${title}-password`}
            ref={passwordInput}
            type={visible ? "text" : "password"}
            autoComplete="off"
            required
            maxLength={128}
            value={password}
            placeholder="输入 VNC 密码"
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="btn"
            aria-label={visible ? "隐藏密码" : "显示密码"}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {!locked && (
          <p>
            <Timer size={14} />
            闲置 {minutes} 分钟后锁定
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="cloud-dialog-actions">
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <button className="btn cloud-primary" type="submit">
            {locked ? "重新连接" : "连接桌面"}
          </button>
        </div>
      </form>
    </section>
  );
}

const presets = [15, 30, 60];

export function DesktopIdle({
  minutes,
  revision,
  changed,
  close,
}: {
  minutes: number;
  revision: number;
  changed: () => void;
  close: () => void;
}) {
  const title = useId();
  const form = useRef<HTMLFormElement>(null);
  const [choice, setChoice] = useState(presets.includes(minutes) ? minutes : 0);
  const [custom, setCustom] = useState(String(minutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    form.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const duration = choice || Number(custom);
    if (!Number.isInteger(duration) || duration < 5 || duration > 120) {
      setInvalid(true);
      setError("请输入 5–120 之间的整数。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveIdle(duration, revision);
      changed();
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存失败");
      changed();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      ref={form}
      className="cloud-idle-popover"
      role="dialog"
      aria-labelledby={title}
      aria-describedby={`${title}-description`}
      noValidate
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="cloud-idle-heading">
        <span className="cloud-idle-icon">
          <Timer size={19} aria-hidden="true" />
        </span>
        <div>
          <h3 id={title}>自动锁定</h3>
          <p id={`${title}-description`}>
            远程桌面无键鼠操作达到设定时长后锁定。
          </p>
        </div>
      </header>
      <div className="cloud-idle-body">
        <div className="cloud-idle-choices" role="group" aria-label="空闲时限">
          {[...presets, 0].map((duration) => (
            <button
              className="cloud-idle-option"
              type="button"
              key={duration}
              aria-pressed={choice === duration}
              onClick={() => {
                setChoice(duration);
                setInvalid(false);
                setError("");
              }}
            >
              {duration ? (
                <strong>{duration}</strong>
              ) : (
                <SlidersHorizontal size={16} aria-hidden="true" />
              )}
              <span>{duration ? "分钟" : "自定义"}</span>
            </button>
          ))}
        </div>
        {choice === 0 && (
          <div className="cloud-idle-custom">
            <div>
              <label htmlFor={`${title}-minutes`}>自定义时长</label>
              <small id={`${title}-range`}>5–120 分钟</small>
            </div>
            <div className="cloud-idle-input">
              <input
                id={`${title}-minutes`}
                aria-describedby={invalid ? `${title}-error` : `${title}-range`}
                aria-invalid={invalid}
                type="number"
                inputMode="numeric"
                min={5}
                max={120}
                step={1}
                required
                value={custom}
                onChange={(event) => {
                  setCustom(event.target.value);
                  if (invalid) {
                    setInvalid(false);
                    setError("");
                  }
                }}
              />
              <span aria-hidden="true">分钟</span>
            </div>
          </div>
        )}
        {error && (
          <p id={`${title}-error`} className="cloud-idle-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="cloud-idle-actions">
        <button type="button" className="btn" onClick={close}>
          取消
        </button>
        <button type="submit" className="btn cloud-primary" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
      </footer>
    </form>
  );
}
