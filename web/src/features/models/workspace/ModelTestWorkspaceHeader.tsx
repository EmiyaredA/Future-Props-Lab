import { useEffect, useRef, type ReactNode } from "react";
import {
  AudioLines,
  Image,
  MessageSquareText,
  Mic2,
  Video,
} from "lucide-react";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";
import "./model-test-header.css";

export type ModelTestMode =
  | "chat"
  | "image"
  | "video"
  | "speech"
  | "synthesis"
  | "realtime_voice"
  | "enhancement";

const modes: Array<{
  id: ModelTestMode;
  label: string;
  icon: typeof MessageSquareText;
}> = [
  { id: "chat", label: "文本对话", icon: MessageSquareText },
  { id: "image", label: "图像生成", icon: Image },
  { id: "video", label: "视频生成", icon: Video },
  { id: "enhancement", label: "视频增强", icon: Video },
  { id: "synthesis", label: "语音合成", icon: AudioLines },
  { id: "speech", label: "语音识别", icon: Mic2 },
  { id: "realtime_voice", label: "实时语音", icon: AudioLines },
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
  availableModes: Partial<Record<ModelTestMode, boolean>>;
  onSelectMode: (mode: ModelTestMode) => void;
  modelId: string;
  modelOptions: SelectOption[];
  onSelectModel: (modelId: string) => void;
  modelDisabled?: boolean;
  actions?: ReactNode;
}) {
  const modeTabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = modeTabs.current;
    if (!list) return;
    const revealSelected = () => {
      const selected = list.querySelector<HTMLElement>(
        '[aria-selected="true"]',
      );
      if (!selected || list.scrollWidth <= list.clientWidth) return;
      const bounds = list.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (item.left < bounds.left) list.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right)
        list.scrollLeft += item.right - bounds.right;
    };
    revealSelected();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(revealSelected);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeMode]);
  return (
    <header className="model-test-workspace-header">
      <div className="model-test-workspace-title">
        <h1>模型测试</h1>
        <p>统一验证对话、图像、视频、识别与实时语音能力。</p>
      </div>
      <div
        className="model-test-mode-tabs"
        ref={modeTabs}
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
