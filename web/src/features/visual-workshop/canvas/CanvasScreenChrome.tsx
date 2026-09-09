import type { ComponentProps } from "react";
import {
  ArrowLeft,
  FolderCog,
  FolderOpen,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
} from "lucide-react";
import { CanvasViewControls } from "@features/visual-workshop/canvas/CanvasViewControls";
import { ThemeToggle } from "@shared/ui/ThemeToggle";

type CanvasScreenChromeProps = {
  projectTitle: string;
  title: string;
  editingTitle: boolean;
  saveState: "saving" | "saved" | "conflict" | "error";
  assistantOpen: boolean;
  assetsOpen: boolean;
  controls: ComponentProps<typeof CanvasViewControls>;
  onBack: () => void;
  onAssets: () => void;
  onStartTitleEditing: () => void;
  onTitleChange: (title: string) => void;
  onSubmitTitle: () => void;
  onBlurTitle: () => void;
  onToggleAssistant: () => void;
  onToggleAssets: () => void;
  onCreate: () => void;
};

export function CanvasScreenChrome({
  projectTitle,
  title,
  editingTitle,
  saveState,
  assistantOpen,
  assetsOpen,
  controls,
  onBack,
  onAssets,
  onStartTitleEditing,
  onTitleChange,
  onSubmitTitle,
  onBlurTitle,
  onToggleAssistant,
  onToggleAssets,
  onCreate,
}: CanvasScreenChromeProps) {
  return (
    <>
      <header className="visual-canvas-topbar">
        <div className="canvas-project-identity">
          <img
            className="canvas-brand-mark"
            src="/brand/visual-workshop-mark-cutout.png"
            alt=""
          />
          <button aria-label="返回项目列表" onClick={onBack}>
            <ArrowLeft aria-hidden />
          </button>
          {editingTitle ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSubmitTitle();
              }}
            >
              <input
                autoFocus
                maxLength={120}
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                onBlur={onBlurTitle}
              />
            </form>
          ) : (
            <button className="canvas-title" onClick={onStartTitleEditing}>
              {projectTitle}
              <Pencil aria-hidden />
            </button>
          )}
          <span className={`canvas-save-state ${saveState}`} role="status">
            <Save aria-hidden />
            {saveState === "saving"
              ? "保存中"
              : saveState === "saved"
                ? "已保存"
                : saveState === "conflict"
                  ? "存在冲突"
                  : "保存失败"}
          </span>
        </div>
        <div className="canvas-top-actions">
          <ThemeToggle />
          <button
            className={
              assistantOpen
                ? "active canvas-assistant-trigger"
                : "canvas-assistant-trigger"
            }
            aria-label="对话"
            aria-expanded={assistantOpen}
            onClick={onToggleAssistant}
          >
            <MessageSquareText aria-hidden />
            对话
          </button>
        </div>
      </header>
      <nav className="canvas-tool-dock" aria-label="画布工具">
        <button aria-label="添加内容" title="添加内容" onClick={onCreate}>
          <Plus aria-hidden />
        </button>
        <button
          className={assetsOpen ? "active" : ""}
          aria-label="素材库"
          title="素材库"
          onClick={onToggleAssets}
        >
          <FolderOpen aria-hidden />
        </button>
        <button aria-label="管理素材" title="管理素材" onClick={onAssets}>
          <FolderCog aria-hidden />
        </button>
      </nav>
      <CanvasViewControls {...controls} />
    </>
  );
}
