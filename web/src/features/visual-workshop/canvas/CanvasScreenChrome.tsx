import type { ComponentProps } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { CanvasViewControls } from "@features/visual-workshop/canvas/CanvasViewControls";
import {
  VisualProjectHeader,
  type VisualProjectHeaderProps,
} from "./VisualProjectHeader";

type CanvasScreenChromeProps = VisualProjectHeaderProps & {
  assetsOpen: boolean;
  createMenuOpen: boolean;
  controls: ComponentProps<typeof CanvasViewControls>;
  onToggleAssets: () => void;
  onCreate: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export function CanvasScreenChrome({
  assetsOpen,
  createMenuOpen,
  controls,
  onToggleAssets,
  onCreate,
  ...header
}: CanvasScreenChromeProps) {
  return (
    <>
      <VisualProjectHeader {...header} />
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
