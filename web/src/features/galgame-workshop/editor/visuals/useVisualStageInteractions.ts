import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type {
  GalgameStoryScene,
  GalgameStorySceneLayer,
} from "@features/galgame-workshop/api";
import {
  clamp,
  distanceAtPercent,
} from "@features/galgame-workshop/editor/visuals/model";

type UpdateScene = (
  sceneId: string,
  updater: (scene: GalgameStoryScene) => GalgameStoryScene,
) => void;

export function useVisualStageInteractions({
  stageMode,
  selectedScene,
  selectedLayer,
  updateScene,
}: {
  stageMode: "preview" | "layer";
  selectedScene?: GalgameStoryScene;
  selectedLayer?: GalgameStorySceneLayer;
  updateScene: UpdateScene;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const distanceAxisRef = useRef<HTMLDivElement>(null);
  const pointerDrag = useRef<
    | {
        kind: "camera";
        startX: number;
        startY: number;
        cameraX: number;
        cameraY: number;
      }
    | {
        kind: "layer";
        startX: number;
        startY: number;
        offsetX: number;
        offsetY: number;
        layerId: string;
      }
    | undefined
  >(undefined);
  const layerDraftRef = useRef<
    { layerId: string; offsetX: number; offsetY: number } | undefined
  >(undefined);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [layerDraft, setLayerDraft] = useState<{
    layerId: string;
    offsetX: number;
    offsetY: number;
  }>();

  const resetStage = useCallback(() => {
    setCamera({ x: 0, y: 0, zoom: 1 });
    setLayerDraft(undefined);
    layerDraftRef.current = undefined;
    pointerDrag.current = undefined;
  }, []);

  const startStageDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (stageMode === "layer" && selectedScene && selectedLayer) {
      pointerDrag.current = {
        kind: "layer",
        startX: event.clientX,
        startY: event.clientY,
        offsetX: selectedLayer.offsetX,
        offsetY: selectedLayer.offsetY,
        layerId: selectedLayer.id,
      };
      return;
    }
    pointerDrag.current = {
      kind: "camera",
      startX: event.clientX,
      startY: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
    };
  };

  const moveStageDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pointerDrag.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (drag.kind === "camera") {
      setCamera((current) => ({
        ...current,
        x: Math.round(drag.cameraX - deltaX),
        y: Math.round(drag.cameraY - deltaY),
      }));
      return;
    }
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const draft = {
      layerId: drag.layerId,
      offsetX: clamp(
        drag.offsetX + (deltaX / bounds.width / camera.zoom) * 100,
        -200,
        200,
      ),
      offsetY: clamp(
        drag.offsetY + (deltaY / bounds.height / camera.zoom) * 100,
        -200,
        200,
      ),
    };
    layerDraftRef.current = draft;
    setLayerDraft(draft);
  };

  const finishStageDrag = () => {
    const drag = pointerDrag.current;
    pointerDrag.current = undefined;
    if (drag?.kind !== "layer" || !selectedScene) return;
    const draft = layerDraftRef.current;
    layerDraftRef.current = undefined;
    setLayerDraft(undefined);
    if (!draft) return;
    updateScene(selectedScene.id, (scene) => ({
      ...scene,
      layers: (scene.layers ?? []).map((layer) =>
        layer.id === draft.layerId
          ? { ...layer, offsetX: draft.offsetX, offsetY: draft.offsetY }
          : layer,
      ),
    }));
  };

  const zoomStage = (zoom: number) =>
    setCamera((current) => ({ ...current, zoom: clamp(zoom, 0.25, 4) }));

  const wheelStage = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoomStage(camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1));
  };

  const setLayerDistance = (layerId: string, distance: number) => {
    if (!selectedScene) return;
    updateScene(selectedScene.id, (scene) => ({
      ...scene,
      layers: (scene.layers ?? []).map((layer) =>
        layer.id === layerId
          ? { ...layer, distance: clamp(distance, 0.1, 100) }
          : layer,
      ),
    }));
  };

  const distanceFromPointer = (clientX: number) => {
    const bounds = distanceAxisRef.current?.getBoundingClientRect();
    if (!bounds) return 1;
    return distanceAtPercent(((clientX - bounds.left) / bounds.width) * 100);
  };

  return {
    stageRef,
    distanceAxisRef,
    camera,
    setCamera,
    layerDraft,
    resetStage,
    startStageDrag,
    moveStageDrag,
    finishStageDrag,
    zoomStage,
    wheelStage,
    setLayerDistance,
    distanceFromPointer,
  };
}
