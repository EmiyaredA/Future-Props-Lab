import type { ComponentProps } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { cardKinds, cardKindInfo } from "../creative/cardKinds";
import type { CardKind } from "../creative/api";
import { CanvasViewControls } from "@features/visual-workshop/canvas/CanvasViewControls";
import {
  VisualProjectHeader,
  type VisualProjectHeaderProps,
} from "./VisualProjectHeader";

type CanvasScreenChromeProps = VisualProjectHeaderProps & {
  embedded?: boolean;
  assetsOpen: boolean;
  designKind?: CardKind;
  onDesign?: (kind: CardKind) => void;
  createMenuOpen: boolean;
  controls: ComponentProps<typeof CanvasViewControls>;
  onToggleAssets: () => void;
  onCreate: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export function CanvasScreenChrome({
  embedded = false,
  assetsOpen,
  createMenuOpen,
  designKind,
  onDesign,
  controls,
  onToggleAssets,
  onCreate,
  ...header
}: CanvasScreenChromeProps) {
  return (
    <>
      {!embedded && <VisualProjectHeader {...header} />}
      {embedded && (
        <button
          type="button"
          className="workbench-add-content"
          aria-label="添加内容"
          title="添加内容"
          aria-expanded={createMenuOpen}
          onClick={onCreate}
        >
          <Plus size={16} aria-hidden />
        </button>
      )}
      {!embedded && (
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
          {cardKinds.map((kind) => {
            const Icon = cardKindInfo[kind].icon;
            const label = { character: "人设", scene: "场景", prop: "道具" }[
              kind
            ];
            return (
              <button
                key={kind}
                className={designKind === kind ? "active" : ""}
                aria-label={label}
                aria-pressed={designKind === kind}
                title={label}
                onClick={() => onDesign?.(kind)}
              >
                <Icon aria-hidden />
                <span className="canvas-dock-label">{label}</span>
              </button>
            );
          })}
        </nav>
      )}
      <CanvasViewControls {...controls} />
    </>
  );
}
