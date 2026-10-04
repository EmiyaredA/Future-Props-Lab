import { ArrowLeft, CirclePlay, RefreshCw, Save } from "lucide-react";

export type EditorTab =
  "look" | "events" | "lines" | "chat" | "habits" | "preview";

export function EditorHeader({
  title,
  status,
  tab,
  busy,
  canSave,
  active,
  onBack,
  onTab,
  onSave,
  onLaunch,
  onRestart,
}: {
  title: string;
  status: string;
  tab: EditorTab;
  busy: boolean;
  canSave: boolean;
  active: boolean;
  onBack: () => void;
  onTab: (tab: EditorTab) => void;
  onSave: () => void;
  onLaunch: () => void;
  onRestart: () => void;
}) {
  return (
    <header className="dp-editor-header">
      <button className="dp-back" onClick={onBack} aria-label="返回桌宠项目">
        <ArrowLeft size={18} />
      </button>
      <div className="dp-editor-title">
        <strong title={title}>{title}</strong>
        <small>{status}</small>
      </div>
      <nav aria-label="桌宠编辑步骤">
        {(
          [
            ["look", "形象"],
            ["events", "交互"],
            ["lines", "台词"],
            ["chat", "聊天"],
            ["habits", "习惯"],
            ["preview", "试玩"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="dp-editor-header-actions">
        <button disabled={busy || !canSave} onClick={onSave}>
          <Save size={15} />
          保存
        </button>
        {active && (
          <button
            disabled={busy}
            onClick={onRestart}
            title="关闭后按已保存配置重开，保留编辑器草稿"
          >
            <RefreshCw size={15} />
            重启桌宠
          </button>
        )}
        <button
          className="dp-primary"
          disabled={busy}
          onClick={onLaunch}
          title="使用已保存配置；草稿通过同步预览临时联动"
        >
          <CirclePlay size={15} />
          {active ? "显示桌宠" : "放到桌面"}
        </button>
      </div>
    </header>
  );
}
