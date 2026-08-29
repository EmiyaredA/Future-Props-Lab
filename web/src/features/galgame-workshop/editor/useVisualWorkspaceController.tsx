import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  cgReferences,
  clamp,
  cleanLabel,
  sceneReferences,
  type PickerTarget,
  type VisualMenuState,
  type VisualSelection,
} from "@features/galgame-workshop/editor/visuals/model";
import { useVisualStageInteractions } from "@features/galgame-workshop/editor/visuals/useVisualStageInteractions";
import { invalidateGalgameAssetQueries } from "@features/galgame-workshop/queryKeys";

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
  const [isolatedLayerId, setIsolatedLayerId] = useState<string>();
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

  const {
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
  } = useVisualStageInteractions({
    stageMode,
    selectedScene,
    selectedLayer,
    updateScene,
  });

  useEffect(() => {
    resetStage();
    setIsolatedLayerId(undefined);
  }, [resetStage, selection?.id, selection?.kind]);

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
    renaming,
    setRenaming,
    renameInputRef,
    renameDraft,
    setRenameDraft,
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
    moveCg,
    beginRename,
    commitRename,
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
    openItemMenu,
    menuScene,
    menuCg,
    menuReferences,
  };
}
