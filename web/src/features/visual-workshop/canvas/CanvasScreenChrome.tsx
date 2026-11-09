import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { LoadingState } from "@shared/ui/LoadingState";
import { AmadeusButton } from "@platform/AmadeusButton";
import type { ComponentProps } from "react";
import {
  AppWindow,
  ArrowLeft,
  FolderOpen,
  MessageSquareText,
  Pencil,
  Plus,
  Save,
} from "lucide-react";
import { CanvasViewControls } from "@features/visual-workshop/canvas/CanvasViewControls";
import { ThemeToggle } from "@shared/ui/ThemeToggle";

function openCurrentPageInNewWindow() {
  window.open(window.location.href, "_blank", "noopener,noreferrer");
}

type CanvasScreenChromeProps = {
  onBoard?: () => void;
  onAcceptance?: () => void;
  projectTitle: string;
  title: string;
  editingTitle: boolean;
  saveState: "saving" | "saved" | "conflict" | "error";
  assistantOpen: boolean;
  assetsOpen: boolean;
  createMenuOpen: boolean;
  controls: ComponentProps<typeof CanvasViewControls>;
  onBack: () => void;
  onStartTitleEditing: () => void;
  onTitleChange: (title: string) => void;
  onSubmitTitle: () => void;
  onBlurTitle: () => void;
  onToggleAssistant: () => void;
  onToggleAssets: () => void;
  onCreate: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export function CanvasScreenChrome({
  onBoard,
  onAcceptance,
  projectTitle,
  title,
  editingTitle,
  saveState,
  assistantOpen,
  assetsOpen,
  createMenuOpen,
  controls,
  onBack,
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
          <ResponsiveImage
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
                aria-label="项目名称"
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
            {saveState === "saving" ? (
              <LoadingState variant="inline" label="保存中" />
            ) : saveState === "saved" ? (
              "已保存"
            ) : saveState === "conflict" ? (
              "存在冲突"
            ) : (
              "保存失败"
            )}
          </span>
        </div>
        <div className="canvas-top-actions">
          {onBoard && (
            <div
              className="visual-project-view-toggle"
              role="group"
              aria-label="项目视图"
            >
              <button className="active" aria-pressed="true">
                画布
              </button>
              <button aria-pressed="false" onClick={onBoard}>
                看板
              </button>
            </div>
          )}
          <AmadeusButton />
          <button
            type="button"
            aria-label="新建窗口"
            onClick={openCurrentPageInNewWindow}
          >
            <AppWindow aria-hidden />
            新建窗口
          </button>
          {onAcceptance && <button onClick={onAcceptance}>项目验收</button>}
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
        <button
          type="button"
          aria-label="添加内容"
          aria-expanded={createMenuOpen}
          title="添加内容"
          onClick={onCreate}
        >
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
      </nav>
      <CanvasViewControls {...controls} />
    </>
  );
}
