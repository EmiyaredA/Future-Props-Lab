import type { ReactNode } from "react";
import { Image, MessageSquareText, Mic2, Video } from "lucide-react";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";

export type ModelTestMode = "chat" | "image" | "video" | "audio";

const modes: Array<{
  id: ModelTestMode;
  label: string;
  icon: typeof MessageSquareText;
}> = [
  { id: "chat", label: "文本对话", icon: MessageSquareText },
  { id: "image", label: "图片生成", icon: Image },
  { id: "video", label: "视频生成", icon: Video },
  { id: "audio", label: "音频生成", icon: Mic2 },
];

export function ModelTestWorkspaceHeader({
  activeMode,
  availableModes,
  onSelectMode,
  modelId,
  modelOptions,
  onSelectModel,
  modelDisabled = false,
  actions,
}: {
  activeMode: ModelTestMode;
  availableModes: Record<ModelTestMode, boolean>;
  onSelectMode: (mode: ModelTestMode) => void;
  modelId: string;
  modelOptions: SelectOption[];
  onSelectModel: (modelId: string) => void;
  modelDisabled?: boolean;
  actions?: ReactNode;
}) {
  return (
    <header className="model-test-workspace-header">
      <div className="model-test-workspace-title">
        <h1>模型测试</h1>
        <p>统一验证对话、图片、视频与语音模型能力。</p>
      </div>
      <div
        className="model-test-mode-tabs"
        role="tablist"
        aria-label="测试类型"
      >
        {modes.map((mode) => {
          const Icon = mode.icon;
          const available = availableModes[mode.id];
          return (
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === mode.id}
              className={activeMode === mode.id ? "active" : ""}
              disabled={!available}
              key={mode.id}
              onClick={() => onSelectMode(mode.id)}
            >
              <Icon aria-hidden />
              <span>{mode.label}</span>
              {mode.id === "audio" && !available ? <small>待接入</small> : null}
            </button>
          );
        })}
      </div>
      <label className="model-test-header-model">
        <span>测试模型</span>
        <CustomSelect
          ariaLabel="测试模型"
          value={modelId}
          options={modelOptions}
          onChange={onSelectModel}
          disabled={modelDisabled || !modelOptions.length}
        />
      </label>
      {actions ? (
        <div className="model-test-header-actions">{actions}</div>
      ) : null}
    </header>
  );
}
