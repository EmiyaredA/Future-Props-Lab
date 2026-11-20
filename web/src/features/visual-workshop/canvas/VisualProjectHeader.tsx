import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { LoadingState } from "@shared/ui/LoadingState";
import { AmadeusButton } from "@platform/AmadeusButton";
import { AppWindow, ArrowLeft, Pencil, Save } from "lucide-react";
import { ThemeToggle } from "@shared/ui/ThemeToggle";

function openCurrentPageInNewWindow() {
  window.open(window.location.href, "_blank", "noopener,noreferrer");
}

export type VisualProjectHeaderProps = {
  activeView?: "canvas" | "previs" | "script";
  onCanvas?: () => void;
  busy?: boolean;
  onBoard?: () => void;
  onPrevis?: () => void;
  onScript?: () => void;
  onAcceptance?: () => void;
  projectTitle: string;
  title: string;
  editingTitle: boolean;
  saveState: "saving" | "saved" | "conflict" | "error";
  onBack: () => void;
  onStartTitleEditing: () => void;
  onTitleChange: (title: string) => void;
  onSubmitTitle: () => void;
  onBlurTitle: () => void;
};

export function VisualProjectHeader({
  activeView = "canvas",
  onCanvas,
  onBoard,
  onPrevis,
  onScript,
  onAcceptance,
  projectTitle,
  title,
  editingTitle,
  saveState,
  onBack,
  onStartTitleEditing,
  onTitleChange,
  onSubmitTitle,
  onBlurTitle,
  busy,
}: VisualProjectHeaderProps) {
  return (
    <header className="visual-canvas-topbar">
      <div className="canvas-project-identity">
        <ResponsiveImage
          className="canvas-brand-mark"
          src="/brand/visual-workshop-mark-cutout.png"
          alt=""
        />
        <button
          type="button"
          aria-label="返回项目列表"
          disabled={busy}
          onClick={onBack}
        >
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
          <button
            type="button"
            className="canvas-title"
            disabled={busy}
            onClick={onStartTitleEditing}
          >
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
            <button
              type="button"
              className={activeView === "canvas" ? "active" : undefined}
              aria-pressed={activeView === "canvas"}
              disabled={busy}
              onClick={onCanvas}
            >
              画布
            </button>
            <button
              type="button"
              aria-pressed="false"
              disabled={busy}
              onClick={onBoard}
            >
              看板
            </button>
            {(onScript || activeView === "script") && (
              <button
                type="button"
                className={activeView === "script" ? "active" : undefined}
                aria-pressed={activeView === "script"}
                disabled={busy}
                onClick={onScript}
              >
                剧本
              </button>
            )}
            {(onPrevis || activeView === "previs") && (
              <button
                type="button"
                className={activeView === "previs" ? "active" : undefined}
                aria-pressed={activeView === "previs"}
                disabled={busy}
                onClick={onPrevis}
              >
                白模预演
              </button>
            )}
          </div>
        )}
        <AmadeusButton />
        {activeView === "canvas" && (
          <button
            type="button"
            aria-label="新建窗口"
            onClick={openCurrentPageInNewWindow}
          >
            <AppWindow aria-hidden />
            新建窗口
          </button>
        )}
        {onAcceptance && (
          <button type="button" disabled={busy} onClick={onAcceptance}>
            项目验收
          </button>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
