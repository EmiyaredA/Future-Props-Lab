import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Images, MapPinned, MoreHorizontal } from "lucide-react";
import {
  uploadGalgameProjectAsset,
  type GalgameStoryCg,
  type GalgameStoryCgVariant,
  type GalgameStoryProject,
  type GalgameStoryScene,
  type GalgameStorySceneLayer,
} from "@features/galgame-workshop/api";
import { stableId } from "@features/galgame-workshop/editor/model";
import { type StoryImagePickerState } from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { invalidateGalgameAssetQueries } from "@features/galgame-workshop/queryKeys";
type VisualSelection = { kind: "scene" | "cg"; id: string };
type VisualMenuState = {
  item: VisualSelection;
  left: number;
  top: number;
  trigger: HTMLButtonElement;
};
type PickerTarget = {
  kind: "scene-layer" | "cg-variant";
  mode: "add" | "replace";
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function cleanLabel(filename: string, fallback: string) {
  return filename.replace(/\.[^.]+$/, "").trim() || fallback;
}

function sceneReferences(document: GalgameStoryProject, sceneId: string) {
  return (document.chapters ?? []).flatMap((chapter) =>
    (chapter.fragments ?? []).flatMap((fragment) =>
      (fragment.blocks ?? []).flatMap((block, index) =>
        block.type === "scene" && block.sceneId === sceneId
          ? [
              {
                chapter: chapter.title,
                fragmentId: fragment.id,
                fragment: fragment.title,
                blockId: block.id,
                index,
              },
            ]
          : [],
      ),
    ),
  );
}

function cgReferences(document: GalgameStoryProject, cgId: string) {
  return (document.chapters ?? []).flatMap((chapter) =>
    (chapter.fragments ?? []).flatMap((fragment) =>
      (fragment.blocks ?? []).flatMap((block, index) =>
        block.type === "showCg" && block.cgId === cgId
          ? [
              {
                chapter: chapter.title,
                fragmentId: fragment.id,
                fragment: fragment.title,
                blockId: block.id,
                index,
                variantId: block.variantId,
              },
            ]
          : [],
      ),
    ),
  );
}

function distanceAtPercent(percent: number) {
  const value = 0.1 * 10 ** ((clamp(percent, 0, 100) / 100) * 3);
  return value < 1 ? Math.round(value * 10) / 10 : Math.round(value * 2) / 2;
}

export function useVisualWorkspaceController({
  projectId,
  document,
  onDocument,
  onLocate,
  onNotice,
  section,
  onSection,
  focusVisual,
  onFocusVisualHandled,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
  onLocate: (fragmentId: string, blockId: string) => void;
  onNotice: (message: string) => void;
  section: "scenes" | "cgs";
  onSection: (section: "scenes" | "cgs") => void;
  focusVisual?: VisualSelection;
  onFocusVisualHandled?: () => void;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
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
    | {
        layerId: string;
        offsetX: number;
        offsetY: number;
      }
    | undefined
  >(undefined);
  const draggedItem = useRef<VisualSelection | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const scenes = useMemo(() => document.scenes ?? [], [document.scenes]);
  const cgs = useMemo(() => document.cgs ?? [], [document.cgs]);
  const groups = useMemo(
    () => document.sceneGroups ?? [],
    [document.sceneGroups],
  );
  const [selection, setSelection] = useState<VisualSelection | undefined>(() =>
    section === "cgs"
      ? cgs[0]
        ? { kind: "cg", id: cgs[0].id }
        : undefined
      : scenes[0]
        ? { kind: "scene", id: scenes[0].id }
        : undefined,
  );
  const [query, setQuery] = useState("");
  const [layerQuery, setLayerQuery] = useState("");
  const [rootsOpen, setRootsOpen] = useState({ scenes: true, cgs: true });
  const [browserOpen, setBrowserOpen] = useState(true);
  const [stackOpen, setStackOpen] = useState(true);
  const [selectedLayerId, setSelectedLayerId] = useState<string>();
  const [selectedVariantId, setSelectedVariantId] = useState<string>();
  const [picker, setPicker] = useState<StoryImagePickerState>();
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>();
  const [stageMode, setStageMode] = useState<"preview" | "layer">("preview");
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [isolatedLayerId, setIsolatedLayerId] = useState<string>();
  const [layerDraft, setLayerDraft] = useState<{
    layerId: string;
    offsetX: number;
    offsetY: number;
  }>();
  const [bottomTab, setBottomTab] = useState<"distance" | "offset">("distance");
  const [distanceDraft, setDistanceDraft] = useState<{
    layerId: string;
    value: number;
  }>();
  const [itemMenu, setItemMenu] = useState<VisualMenuState>();
  const [renaming, setRenaming] = useState<VisualSelection>();
  const [renameDraft, setRenameDraft] = useState("");

  const selectedScene =
    selection?.kind === "scene"
      ? scenes.find((scene) => scene.id === selection.id)
      : undefined;
  const selectedCg =
    selection?.kind === "cg"
      ? cgs.find((cg) => cg.id === selection.id)
      : undefined;
  const layers = selectedScene?.layers ?? [];
  const variants = selectedCg?.variants ?? [];
  const selectedLayer =
    layers.find((layer) => layer.id === selectedLayerId) ?? layers[0];
  const defaultVariant = variants.find(
    (variant) => variant.id === selectedCg?.defaultVariantId,
  );
  const selectedVariant =
    variants.find((variant) => variant.id === selectedVariantId) ??
    defaultVariant ??
    variants[0];
  const assetsById = useMemo(
    () => new Map((document.assets ?? []).map((asset) => [asset.id, asset])),
    [document.assets],
  );
  const usedFileIds = useMemo(
    () => new Set((document.assets ?? []).map((asset) => asset.fileId)),
    [document.assets],
  );
  const sceneRefs = selectedScene
    ? sceneReferences(document, selectedScene.id)
    : [];
  const cgRefs = selectedCg ? cgReferences(document, selectedCg.id) : [];
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleScenes = scenes.filter((scene) =>
    `${scene.name} ${scene.description} ${(scene.layers ?? [])
      .map((layer) => layer.name)
      .join(" ")}`
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedQuery),
  );
  const visibleCgs = cgs.filter((cg) =>
    `${cg.name} ${cg.description} ${(cg.variants ?? [])
      .map((variant) => variant.label)
      .join(" ")}`
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedQuery),
  );
  const filteredLayers = layers.filter((layer) =>
    layer.name
      .toLocaleLowerCase("zh-CN")
      .includes(layerQuery.trim().toLocaleLowerCase("zh-CN")),
  );

  useEffect(() => {
    if (!focusVisual) return;
    const exists =
      focusVisual.kind === "scene"
        ? scenes.some((scene) => scene.id === focusVisual.id)
        : cgs.some((cg) => cg.id === focusVisual.id);
    if (!exists) return;
    setSelection(focusVisual);
    onSection(focusVisual.kind === "scene" ? "scenes" : "cgs");
    onFocusVisualHandled?.();
  }, [cgs, focusVisual, onFocusVisualHandled, onSection, scenes]);

  useEffect(() => {
    if (focusVisual) return;
    const requestedKind = section === "scenes" ? "scene" : "cg";
    if (selection?.kind === requestedKind) return;
    const requested = requestedKind === "scene" ? scenes[0] : cgs[0];
    if (requested) setSelection({ kind: requestedKind, id: requested.id });
  }, [cgs, focusVisual, scenes, section, selection?.kind]);

  useEffect(() => {
    const currentExists =
      selection?.kind === "scene"
        ? scenes.some((scene) => scene.id === selection.id)
        : selection?.kind === "cg"
          ? cgs.some((cg) => cg.id === selection.id)
          : false;
    if (currentExists) return;
    const fallback =
      (section === "cgs" && cgs[0]
        ? ({ kind: "cg", id: cgs[0].id } as const)
        : undefined) ??
      (scenes[0]
        ? ({ kind: "scene", id: scenes[0].id } as const)
        : cgs[0]
          ? ({ kind: "cg", id: cgs[0].id } as const)
          : undefined);
    setSelection(fallback);
  }, [cgs, scenes, section, selection]);

  useEffect(() => {
    setCamera({ x: 0, y: 0, zoom: 1 });
    setIsolatedLayerId(undefined);
    setLayerDraft(undefined);
    layerDraftRef.current = undefined;
  }, [selection?.id, selection?.kind]);

  useEffect(() => {
    if (selectedLayer && selectedLayer.id !== selectedLayerId)
      setSelectedLayerId(selectedLayer.id);
    if (!selectedLayer) setSelectedLayerId(undefined);
  }, [selectedLayer, selectedLayerId]);

  useEffect(() => {
    if (selectedVariant && selectedVariant.id !== selectedVariantId)
      setSelectedVariantId(selectedVariant.id);
    if (!selectedVariant) setSelectedVariantId(undefined);
  }, [selectedVariant, selectedVariantId]);

  useEffect(() => {
    if (!itemMenu) return;
    const closeOnPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        itemMenu.trigger.contains(target)
      )
        return;
      setItemMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setItemMenu(undefined);
      itemMenu.trigger.focus();
    };
    const closeOnViewportChange = () => setItemMenu(undefined);
    const focusFirstItem = window.setTimeout(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(
          'button[role="menuitem"]:not(:disabled)',
        )
        ?.focus();
    });
    globalThis.document.addEventListener("mousedown", closeOnPointer);
    globalThis.document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      window.clearTimeout(focusFirstItem);
      globalThis.document.removeEventListener("mousedown", closeOnPointer);
      globalThis.document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [itemMenu]);

  useEffect(() => {
    if (!renaming) return;
    const focusRename = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.clearTimeout(focusRename);
  }, [renaming]);

  const selectVisual = (next: VisualSelection) => {
    setSelection(next);
    onSection(next.kind === "scene" ? "scenes" : "cgs");
  };

  const updateScene = (
    sceneId: string,
    updater: (scene: GalgameStoryScene) => GalgameStoryScene,
  ) =>
    onDocument({
      ...document,
      scenes: scenes.map((scene) =>
        scene.id === sceneId ? updater(scene) : scene,
      ),
    });

  const updateCg = (
    cgId: string,
    updater: (cg: GalgameStoryCg) => GalgameStoryCg,
  ) =>
    onDocument({
      ...document,
      cgs: cgs.map((cg) => (cg.id === cgId ? updater(cg) : cg)),
    });

  const ensureStoryAsset = (fileId: string, kind: PickerTarget["kind"]) => {
    const role: "sceneLayer" | "storyCg" =
      kind === "scene-layer" ? "sceneLayer" : "storyCg";
    const existing = (document.assets ?? []).find(
      (asset) =>
        asset.type === "image" &&
        asset.fileId === fileId &&
        asset.role === role,
    );
    if (existing)
      return { assetId: existing.id, assets: document.assets ?? [] };
    const assetId = stableId();
    return {
      assetId,
      assets: [
        ...(document.assets ?? []),
        {
          id: assetId,
          type: "image" as const,
          role,
          fileId,
          status: "ready" as const,
        },
      ],
    };
  };

  const bindFile = (fileId: string, filename: string) => {
    if (!pickerTarget) return;
    const { assetId, assets } = ensureStoryAsset(fileId, pickerTarget.kind);
    if (pickerTarget.kind === "scene-layer" && selectedScene) {
      const label = cleanLabel(filename, `图层 ${layers.length + 1}`);
      if (pickerTarget.mode === "replace" && selectedLayer) {
        onDocument({
          ...document,
          assets,
          scenes: scenes.map((scene) =>
            scene.id === selectedScene.id
              ? {
                  ...scene,
                  layers: (scene.layers ?? []).map((layer) =>
                    layer.id === selectedLayer.id
                      ? { ...layer, assetId, name: label }
                      : layer,
                  ),
                }
              : scene,
          ),
        });
      } else {
        const layer: GalgameStorySceneLayer = {
          id: stableId(),
          name: label,
          assetId,
          distance: 1,
          offsetX: 0,
          offsetY: 0,
        };
        setSelectedLayerId(layer.id);
        onDocument({
          ...document,
          assets,
          scenes: scenes.map((scene) =>
            scene.id === selectedScene.id
              ? { ...scene, layers: [...(scene.layers ?? []), layer] }
              : scene,
          ),
        });
      }
      onNotice("场景图层已加入当前场景。");
    }
    if (pickerTarget.kind === "cg-variant" && selectedCg) {
      const label = cleanLabel(filename, `差分 ${variants.length + 1}`);
      if (pickerTarget.mode === "replace" && selectedVariant) {
        onDocument({
          ...document,
          assets,
          cgs: cgs.map((cg) =>
            cg.id === selectedCg.id
              ? {
                  ...cg,
                  variants: (cg.variants ?? []).map((variant) =>
                    variant.id === selectedVariant.id
                      ? { ...variant, assetId, label }
                      : variant,
                  ),
                }
              : cg,
          ),
        });
      } else {
        const variant: GalgameStoryCgVariant = {
          id: stableId(),
          label,
          assetId,
        };
        setSelectedVariantId(variant.id);
        onDocument({
          ...document,
          assets,
          cgs: cgs.map((cg) =>
            cg.id === selectedCg.id
              ? {
                  ...cg,
                  variants: [...(cg.variants ?? []), variant],
                  defaultVariantId: cg.defaultVariantId ?? variant.id,
                }
              : cg,
          ),
        });
      }
      onNotice("CG 差分已加入当前 CG。");
    }
    setPicker(undefined);
    setPickerTarget(undefined);
  };

  const upload = useMutation({
    mutationFn: ({ file, target }: { file: File; target: PickerTarget }) =>
      uploadGalgameProjectAsset(
        projectId,
        file,
        target.kind === "scene-layer" ? "scene" : "cg",
      ),
    onSuccess: (asset) => {
      bindFile(asset.id, asset.display_name);
      void invalidateGalgameAssetQueries(client, projectId);
    },
    onError: () => onNotice("图片上传失败，请检查格式和文件大小。"),
  });

  const openPicker = (
    kind: PickerTarget["kind"],
    mode: PickerTarget["mode"],
  ) => {
    setPickerTarget({ kind, mode });
    setPicker({ mode, source: "project" });
  };

  const createScene = () => {
    const scene: GalgameStoryScene = {
      id: stableId(),
      name: `新场景 ${scenes.length + 1}`,
      description: "",
      layers: [],
    };
    onDocument({ ...document, scenes: [...scenes, scene] });
    setRootsOpen((current) => ({ ...current, scenes: true }));
    selectVisual({ kind: "scene", id: scene.id });
  };

  const createCg = () => {
    const cg: GalgameStoryCg = {
      id: stableId(),
      name: cgs.length ? `新剧情 CG ${cgs.length + 1}` : "新剧情 CG",
      description: "",
      variants: [],
      defaultVariantId: null,
    };
    onDocument({ ...document, cgs: [...cgs, cg] });
    setRootsOpen((current) => ({ ...current, cgs: true }));
    selectVisual({ kind: "cg", id: cg.id });
  };

  const duplicateVisual = (target: VisualSelection) => {
    if (target.kind === "scene") {
      const source = scenes.find((scene) => scene.id === target.id);
      if (!source) return;
      const copy: GalgameStoryScene = {
        ...source,
        id: stableId(),
        name: `${source.name} 副本`,
        layers: (source.layers ?? []).map((layer) => ({
          ...layer,
          id: stableId(),
        })),
      };
      onDocument({ ...document, scenes: [...scenes, copy] });
      selectVisual({ kind: "scene", id: copy.id });
      return;
    }
    const source = cgs.find((cg) => cg.id === target.id);
    if (source) {
      const sourceVariants = source.variants ?? [];
      const variantsCopy = sourceVariants.map((variant) => ({
        ...variant,
        id: stableId(),
      }));
      const defaultIndex = sourceVariants.findIndex(
        (variant) => variant.id === source.defaultVariantId,
      );
      const copy: GalgameStoryCg = {
        ...source,
        id: stableId(),
        name: `${source.name} 副本`,
        variants: variantsCopy,
        defaultVariantId:
          defaultIndex >= 0 ? variantsCopy[defaultIndex]?.id : null,
      };
      onDocument({ ...document, cgs: [...cgs, copy] });
      selectVisual({ kind: "cg", id: copy.id });
    }
  };

  const moveScene = (
    sceneId: string,
    targetSceneId: string | undefined,
    groupId: string | null,
  ) => {
    const source = scenes.find((scene) => scene.id === sceneId);
    if (!source) return;
    const remaining = scenes.filter((scene) => scene.id !== sceneId);
    const targetIndex = targetSceneId
      ? remaining.findIndex((scene) => scene.id === targetSceneId)
      : remaining.length;
    remaining.splice(targetIndex < 0 ? remaining.length : targetIndex, 0, {
      ...source,
      groupId,
    });
    onDocument({ ...document, scenes: remaining });
  };

  const moveCg = (cgId: string, targetCgId: string) => {
    const source = cgs.find((cg) => cg.id === cgId);
    if (!source || cgId === targetCgId) return;
    const remaining = cgs.filter((cg) => cg.id !== cgId);
    const targetIndex = remaining.findIndex((cg) => cg.id === targetCgId);
    remaining.splice(
      targetIndex < 0 ? remaining.length : targetIndex,
      0,
      source,
    );
    onDocument({ ...document, cgs: remaining });
  };

  const beginRename = (target: VisualSelection) => {
    const visual =
      target.kind === "scene"
        ? scenes.find((scene) => scene.id === target.id)
        : cgs.find((cg) => cg.id === target.id);
    if (!visual) return;
    setItemMenu(undefined);
    setRenameDraft(visual.name);
    setRenaming(target);
  };

  const commitRename = () => {
    if (!renaming) return;
    const name = renameDraft.trim();
    if (!name) {
      onNotice("名称不能为空。");
      setRenaming(undefined);
      return;
    }
    if (renaming.kind === "scene")
      updateScene(renaming.id, (scene) => ({ ...scene, name }));
    else updateCg(renaming.id, (cg) => ({ ...cg, name }));
    setRenaming(undefined);
  };

  const reorderLayer = (layerId: string, targetId: string) => {
    if (!selectedScene || layerId === targetId) return;
    const source = layers.find((layer) => layer.id === layerId);
    if (!source) return;
    const remaining = layers.filter((layer) => layer.id !== layerId);
    const targetIndex = remaining.findIndex((layer) => layer.id === targetId);
    remaining.splice(
      targetIndex < 0 ? remaining.length : targetIndex,
      0,
      source,
    );
    updateScene(selectedScene.id, (scene) => ({ ...scene, layers: remaining }));
  };

  const reorderVariant = (variantId: string, targetId: string) => {
    if (!selectedCg || variantId === targetId) return;
    const source = variants.find((variant) => variant.id === variantId);
    if (!source) return;
    const remaining = variants.filter((variant) => variant.id !== variantId);
    const targetIndex = remaining.findIndex(
      (variant) => variant.id === targetId,
    );
    remaining.splice(
      targetIndex < 0 ? remaining.length : targetIndex,
      0,
      source,
    );
    updateCg(selectedCg.id, (cg) => ({ ...cg, variants: remaining }));
  };

  const removeVariant = (variant: GalgameStoryCgVariant) => {
    if (!selectedCg) return;
    const effectiveReferences = cgRefs.filter(
      (reference) =>
        reference.variantId === variant.id ||
        (!reference.variantId && selectedCg.defaultVariantId === variant.id),
    );
    if (effectiveReferences.length) {
      onNotice(
        `无法删除：差分仍被 ${effectiveReferences.length} 个显示 CG Block 引用。`,
      );
      return;
    }
    if (selectedCg.defaultVariantId === variant.id && variants.length > 1) {
      onNotice("请先将其他差分设为默认，再删除当前默认差分。");
      return;
    }
    const remaining = variants.filter((item) => item.id !== variant.id);
    updateCg(selectedCg.id, (cg) => ({
      ...cg,
      variants: remaining,
      defaultVariantId: remaining.length ? cg.defaultVariantId : null,
    }));
    setSelectedVariantId(remaining[0]?.id);
  };

  const removeVisual = (target: VisualSelection) => {
    if (target.kind === "scene") {
      if (sceneReferences(document, target.id).length) {
        onNotice("场景仍被 Scene Block 引用，无法删除。");
        return;
      }
      const remaining = scenes.filter((scene) => scene.id !== target.id);
      onDocument({ ...document, scenes: remaining });
      if (selection?.kind === "scene" && selection.id === target.id) {
        const fallback = remaining[0]
          ? ({ kind: "scene", id: remaining[0].id } as const)
          : cgs[0]
            ? ({ kind: "cg", id: cgs[0].id } as const)
            : undefined;
        if (fallback) selectVisual(fallback);
        else setSelection(undefined);
      }
      return;
    }
    if (cgReferences(document, target.id).length) {
      onNotice("CG 仍被显示 CG Block 引用，无法删除。");
      return;
    }
    const remaining = cgs.filter((cg) => cg.id !== target.id);
    onDocument({ ...document, cgs: remaining });
    if (selection?.kind === "cg" && selection.id === target.id) {
      const fallback = remaining[0]
        ? ({ kind: "cg", id: remaining[0].id } as const)
        : scenes[0]
          ? ({ kind: "scene", id: scenes[0].id } as const)
          : undefined;
      if (fallback) selectVisual(fallback);
      else setSelection(undefined);
    }
  };

  const removeSelectedVisual = () => {
    if (selection) removeVisual(selection);
  };

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

  const activeImage = selectedScene
    ? assetsById.get(selectedLayer?.assetId ?? "")
    : assetsById.get(selectedVariant?.assetId ?? "");
  const canvasWidth = document.settings?.canvas?.width ?? 1920;
  const canvasHeight = document.settings?.canvas?.height ?? 1080;
  const title = selectedScene?.name ?? selectedCg?.name ?? "尚未创建画面资源";
  const detailCount = selectedScene ? layers.length : variants.length;
  const stageEmpty = selectedScene ? !layers.length : !selectedVariant;

  const openItemMenu = (trigger: HTMLButtonElement, item: VisualSelection) => {
    if (itemMenu?.item.kind === item.kind && itemMenu.item.id === item.id) {
      setItemMenu(undefined);
      return;
    }
    const bounds = trigger.getBoundingClientRect();
    const width = 236;
    const itemCount = item.kind === "scene" ? 7 + groups.length : 4;
    const estimatedHeight = Math.min(
      window.innerHeight - 16,
      itemCount * 38 + 34,
    );
    const left = clamp(bounds.right - width, 8, window.innerWidth - width - 8);
    const top =
      bounds.bottom + estimatedHeight + 4 <= window.innerHeight - 8
        ? bounds.bottom + 4
        : Math.max(8, bounds.top - estimatedHeight - 4);
    setItemMenu({ item, left, top, trigger });
  };

  const renderBrowserItem = (item: VisualSelection) => {
    const scene =
      item.kind === "scene"
        ? scenes.find((candidate) => candidate.id === item.id)
        : undefined;
    const cg =
      item.kind === "cg"
        ? cgs.find((candidate) => candidate.id === item.id)
        : undefined;
    if (!scene && !cg) return null;
    const sceneLayer = scene?.layers?.[0];
    const cgVariant = cg?.variants?.find(
      (variant) => variant.id === cg.defaultVariantId,
    );
    const asset = assetsById.get(
      sceneLayer?.assetId ?? cgVariant?.assetId ?? "",
    );
    const selected = selection?.kind === item.kind && selection.id === item.id;
    const isRenaming = renaming?.kind === item.kind && renaming.id === item.id;
    const menuOpen =
      itemMenu?.item.kind === item.kind && itemMenu.item.id === item.id;
    const name = scene?.name ?? cg?.name ?? "";
    return (
      <div
        key={`${item.kind}-${item.id}`}
        className={`galgame-visual-browser-item${selected ? " active" : ""}`}
        draggable={!isRenaming}
        onDragStart={(event) => {
          if (
            (event.target as HTMLElement).closest(
              ".galgame-visual-browser-menu-trigger",
            )
          ) {
            event.preventDefault();
            return;
          }
          draggedItem.current = item;
          event.dataTransfer.setData("text/visual-id", item.id);
        }}
        onDragEnd={() => {
          draggedItem.current = undefined;
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const dragged = draggedItem.current;
          if (!dragged || dragged.kind !== item.kind) return;
          if (item.kind === "scene")
            moveScene(dragged.id, item.id, scene?.groupId ?? null);
          else moveCg(dragged.id, item.id);
          draggedItem.current = undefined;
        }}
      >
        {isRenaming ? (
          <div className="galgame-visual-browser-open is-renaming">
            <span>
              <StoryAssetImage
                fileId={asset?.fileId}
                alt=""
                fallback={
                  item.kind === "scene" ? (
                    <MapPinned aria-hidden />
                  ) : (
                    <Images aria-hidden />
                  )
                }
              />
            </span>
            <em>
              <input
                ref={renameInputRef}
                aria-label={`重命名${item.kind === "scene" ? "场景" : "CG"}`}
                value={renameDraft}
                maxLength={120}
                onChange={(event) => setRenameDraft(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setRenaming(undefined);
                  }
                }}
              />
              <small>
                {item.kind === "scene"
                  ? `${scene?.layers?.length ?? 0} 层`
                  : `${cg?.variants?.length ?? 0} 个差分`}
              </small>
            </em>
          </div>
        ) : (
          <button
            type="button"
            className="galgame-visual-browser-open"
            onClick={() => selectVisual(item)}
          >
            <span>
              <StoryAssetImage
                fileId={asset?.fileId}
                alt=""
                fallback={
                  item.kind === "scene" ? (
                    <MapPinned aria-hidden />
                  ) : (
                    <Images aria-hidden />
                  )
                }
              />
            </span>
            <em>
              <strong>{name}</strong>
              <small>
                {item.kind === "scene"
                  ? `${scene?.layers?.length ?? 0} 层`
                  : `${cg?.variants?.length ?? 0} 个差分`}
              </small>
            </em>
          </button>
        )}
        <button
          type="button"
          className="galgame-visual-browser-menu-trigger"
          aria-label={`更多操作 ${name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? "galgame-visual-item-menu" : undefined}
          draggable={false}
          onClick={(event) => openItemMenu(event.currentTarget, item)}
        >
          <MoreHorizontal aria-hidden />
        </button>
      </div>
    );
  };

  const menuScene =
    itemMenu?.item.kind === "scene"
      ? scenes.find((scene) => scene.id === itemMenu.item.id)
      : undefined;
  const menuCg =
    itemMenu?.item.kind === "cg"
      ? cgs.find((cg) => cg.id === itemMenu.item.id)
      : undefined;
  const menuReferences = menuScene
    ? sceneReferences(document, menuScene.id)
    : menuCg
      ? cgReferences(document, menuCg.id)
      : [];

  return {
    projectId,
    document,
    onDocument,
    onLocate,
    onNotice,
    section,
    fileInput,
    stageRef,
    distanceAxisRef,
    draggedItem,
    menuRef,
    scenes,
    cgs,
    groups,
    selection,
    query,
    setQuery,
    layerQuery,
    setLayerQuery,
    rootsOpen,
    setRootsOpen,
    browserOpen,
    setBrowserOpen,
    stackOpen,
    setStackOpen,
    setSelectedLayerId,
    setSelectedVariantId,
    picker,
    setPicker,
    pickerTarget,
    setPickerTarget,
    stageMode,
    setStageMode,
    camera,
    setCamera,
    isolatedLayerId,
    setIsolatedLayerId,
    layerDraft,
    bottomTab,
    setBottomTab,
    distanceDraft,
    setDistanceDraft,
    itemMenu,
    setItemMenu,
    selectedScene,
    selectedCg,
    layers,
    variants,
    selectedLayer,
    defaultVariant,
    selectedVariant,
    assetsById,
    usedFileIds,
    sceneRefs,
    cgRefs,
    visibleScenes,
    visibleCgs,
    filteredLayers,
    selectVisual,
    updateScene,
    updateCg,
    bindFile,
    upload,
    openPicker,
    createScene,
    createCg,
    duplicateVisual,
    moveScene,
    beginRename,
    reorderLayer,
    reorderVariant,
    removeVariant,
    removeVisual,
    removeSelectedVisual,
    startStageDrag,
    moveStageDrag,
    finishStageDrag,
    zoomStage,
    wheelStage,
    setLayerDistance,
    distanceFromPointer,
    activeImage,
    canvasWidth,
    canvasHeight,
    title,
    detailCount,
    stageEmpty,
    renderBrowserItem,
    menuScene,
    menuCg,
    menuReferences,
  };
}
