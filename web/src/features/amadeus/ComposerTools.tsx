import {
  Bot,
  Boxes,
  ClipboardList,
  FolderOpen,
  MousePointer2,
  Paperclip,
  Plus,
} from "lucide-react";
import { ActionIcon } from "./ActionIcon";

export function ComposerTools({
  busy,
  standalone,
  atReferenceLimit,
  mode,
  setMode,
  loaded,
  attachFile,
  showFiles,
  attachSelection,
  pick,
  openCapabilities,
}: {
  busy: boolean;
  standalone: boolean;
  atReferenceLimit: boolean;
  mode: "agent" | "plan";
  setMode: (mode: "agent" | "plan") => void;
  loaded: number;
  attachFile: () => void;
  showFiles: () => void;
  attachSelection: () => void;
  pick: () => void;
  openCapabilities: () => void;
}) {
  return (
    <div className="amadeus-toolbar-tools">
      <ActionIcon label="导入会话文件" onClick={attachFile}>
        <Paperclip size={17} aria-hidden />
      </ActionIcon>
      <ActionIcon label="会话文件" onClick={showFiles}>
        <FolderOpen size={17} aria-hidden />
      </ActionIcon>
      {!standalone && (
        <>
          <ActionIcon
            label="引用当前选中项"
            disabled={busy || atReferenceLimit}
            onClick={attachSelection}
          >
            <Plus size={17} aria-hidden />
          </ActionIcon>
          <ActionIcon
            label="点选页面元素"
            disabled={busy || atReferenceLimit}
            onClick={pick}
          >
            <MousePointer2 size={17} aria-hidden />
          </ActionIcon>
        </>
      )}
      <ActionIcon
        label="能力"
        hint={`能力 · 已加载 ${loaded} 项`}
        onClick={openCapabilities}
      >
        <Boxes size={17} aria-hidden />
      </ActionIcon>
      <div className="amadeus-mode-switch" role="group" aria-label="运行模式">
        <ActionIcon
          label="Agent"
          hint={mode === "agent" ? "当前为 Agent 模式" : "切换为 Agent 模式"}
          aria-pressed={mode === "agent"}
          onClick={() => setMode("agent")}
        >
          <Bot size={16} aria-hidden />
        </ActionIcon>
        <ActionIcon
          label="Plan"
          hint={mode === "plan" ? "当前为 Plan 模式" : "切换为 Plan 模式"}
          aria-pressed={mode === "plan"}
          onClick={() => setMode("plan")}
        >
          <ClipboardList size={16} aria-hidden />
        </ActionIcon>
      </div>
    </div>
  );
}
