import type { CSSProperties } from "react";
import type { GalgameStorySceneLayer } from "@features/galgame-workshop/api";
import type { GalgameStageState } from "@features/galgame-workshop/editor/stage";
import type { StageScene } from "@features/galgame-workshop/editor/stageVisualTransitions";

type SceneLayerStyleOptions = {
  index: number;
  state: StageScene;
  layer: GalgameStorySceneLayer;
  camera: GalgameStageState["camera"];
  cameraActive: boolean;
  cameraEasing: string | undefined;
};

export function storyPlayerSceneLayerStyle({
  index,
  state,
  layer,
  camera,
  cameraActive,
  cameraEasing,
}: SceneLayerStyleOptions): CSSProperties {
  const transitionMs = state.transition.fade ? state.transition.durationMs : 0;
  const cameraMs = cameraActive && camera ? camera.durationMs : 0;
  return {
    zIndex: index,
    opacity: state.exiting ? 0 : 1,
    transform:
      cameraActive && camera
        ? `translate(${layer.offsetX + camera.x / layer.distance}%, ${layer.offsetY + camera.y / layer.distance}%) scale(${1 + (camera.scale - 1) / layer.distance}) rotate(${camera.rotation / layer.distance}deg)`
        : `translate(${layer.offsetX}%, ${layer.offsetY}%)`,
    transformOrigin: "center",
    transitionProperty: cameraActive ? "opacity, transform" : "opacity",
    transitionDuration: `${transitionMs}ms, ${cameraMs}ms`,
    transitionTimingFunction: cameraActive ? `ease, ${cameraEasing}` : "ease",
    animationName:
      state.entering && state.transition.fade
        ? "galgame-player-cg-enter"
        : undefined,
    animationTimingFunction: "ease",
    animationFillMode: "both",
    animationDuration: state.entering
      ? `${transitionMs}ms`
      : cameraActive
        ? `${cameraMs}ms`
        : undefined,
  };
}
