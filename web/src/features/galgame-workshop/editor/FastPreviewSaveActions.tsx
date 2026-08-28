import { Save, SaveAll } from "lucide-react";
import "@features/galgame-workshop/editor/fast-preview-save-actions.css";

export function FastPreviewSaveActions({
  dirty,
  saving,
  message,
  canSave,
  canSaveAll,
  pendingCount,
  onSave,
  onSaveAll,
}: {
  dirty: boolean;
  saving: boolean;
  message: string;
  canSave: boolean;
  canSaveAll: boolean;
  pendingCount: number;
  onSave: () => void;
  onSaveAll: () => void;
}) {
  return (
    <footer>
      <span>
        {message ? (
          <small
            role={message.startsWith("保存失败") ? "alert" : "status"}
            data-error={message.startsWith("保存失败") || undefined}
          >
            {message}
          </small>
        ) : null}
        <strong data-dirty={pendingCount ? "true" : undefined}>
          {pendingCount ? `${pendingCount} 个未保存修改` : "已保存"}
        </strong>
      </span>
      <div className="galgame-fast-preview-save-actions">
        <button
          type="button"
          disabled={saving || !canSaveAll}
          title={canSaveAll ? undefined : "当前预览没有连接可保存的故事修订"}
          onClick={onSaveAll}
        >
          <SaveAll aria-hidden />
          {saving ? "正在保存…" : `全部保存（${pendingCount}）`}
        </button>
        <button
          type="button"
          disabled={saving || !canSave || !dirty}
          title={canSave ? undefined : "当前预览没有连接可保存的故事修订"}
          onClick={onSave}
        >
          <Save aria-hidden />
          保存当前
        </button>
      </div>
    </footer>
  );
}
