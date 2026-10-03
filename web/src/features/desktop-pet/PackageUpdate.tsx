import { useId, useRef } from "react";
import { Upload } from "lucide-react";

export function PackageUpdate({
  disabled,
  reason,
  onUpdate,
}: {
  disabled: boolean;
  reason?: string;
  onUpdate: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  return (
    <div className="dp-package-update">
      <button
        type="button"
        className="dp-side-action"
        aria-describedby={hintId}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Upload size={14} /> 更新角色资源包
      </button>
      <input
        ref={input}
        hidden
        type="file"
        accept=".zip,application/zip"
        aria-label="选择更新角色资源包"
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file && !disabled) onUpdate(file);
        }}
      />
      <small id={hintId}>
        {reason ?? "更新分层素材与服饰，保留当前项目、配置和聊天记录。"}
      </small>
    </div>
  );
}
