import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  GripVertical,
  Image as ImageIcon,
  ImagePlus,
  Images,
  MapPinned,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Move,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import {
  uploadGalgameProjectAsset,
  type GalgameStoryCg,
  type GalgameStoryCgVariant,
  type GalgameStoryProject,
  type GalgameStoryScene,
  type GalgameStorySceneLayer,
} from "@features/galgame-workshop/api";
import { stableId } from "@features/galgame-workshop/editor/model";
import {
  StoryImagePicker,
  type StoryImagePickerState,
} from "@features/galgame-workshop/editor/StoryImagePicker";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { InlineEditableName } from "@features/galgame-workshop/editor/EditorShared";

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

function distancePercent(distance: number) {
  return (Math.log10(clamp(distance, 0.1, 100) / 0.1) / 3) * 100;
}

function distanceAtPercent(percent: number) {
  const value = 0.1 * 10 ** ((clamp(percent, 0, 100) / 100) * 3);
  return value < 1 ? Math.round(value * 10) / 10 : Math.round(value * 2) / 2;
}

export function VisualWorkspace({
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
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
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

  return (
    <section className="galgame-unified-visual-workspace">
      <header className="galgame-visual-page-heading">
        <div>
          <Images aria-hidden />
          <strong>场景</strong>
          <span>{scenes.length + cgs.length} 项</span>
        </div>
      </header>
      <div className="galgame-visual-page-subheading">
        <div>
          <strong>场景</strong>
          <span>管理游戏场景背景、CG 与属性</span>
        </div>
        <nav aria-label="工作台面板">
          <button
            type="button"
            aria-label={browserOpen ? "收起资源树" : "展开资源树"}
            title={browserOpen ? "收起资源树" : "展开资源树"}
            aria-pressed={!browserOpen}
            onClick={() => setBrowserOpen((current) => !current)}
          >
            <PanelLeftClose
              className={browserOpen ? "" : "is-flipped"}
              aria-hidden
            />
          </button>
          <button
            type="button"
            aria-label={
              stackOpen
                ? `收起${selectedScene ? "图层" : "差分"}`
                : `展开${selectedScene ? "图层" : "差分"}`
            }
            title={
              stackOpen
                ? `收起${selectedScene ? "图层" : "差分"}`
                : `展开${selectedScene ? "图层" : "差分"}`
            }
            aria-pressed={!stackOpen}
            onClick={() => setStackOpen((current) => !current)}
          >
            <PanelRightClose
              className={stackOpen ? "" : "is-flipped"}
              aria-hidden
            />
          </button>
        </nav>
      </div>

      <div
        className={`galgame-visual-editor-grid${browserOpen ? "" : " is-browser-collapsed"}${stackOpen ? "" : " is-stack-collapsed"}`}
      >
        <aside className="galgame-visual-browser">
          <div className="galgame-visual-browser-toolbar">
            <label>
              <Search aria-hidden />
              <input
                aria-label="搜索场景和 CG"
                value={query}
                placeholder="搜索场景或 CG…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="button" aria-label="新建场景" onClick={createScene}>
              <ImagePlus aria-hidden />
            </button>
            <button type="button" aria-label="新建 CG" onClick={createCg}>
              <Plus aria-hidden />
            </button>
            <button
              type="button"
              aria-label="添加分组"
              onClick={() => {
                const group = {
                  id: stableId(),
                  name: `新分组 ${groups.length + 1}`,
                  color: "#7586E5",
                  collapsed: false,
                };
                onDocument({
                  ...document,
                  sceneGroups: [...groups, group],
                });
              }}
            >
              <FolderOpen aria-hidden />
            </button>
          </div>

          <div className="galgame-visual-browser-tree">
            <section>
              <button
                type="button"
                className="galgame-visual-tree-root"
                aria-expanded={rootsOpen.scenes}
                onClick={() =>
                  setRootsOpen((current) => ({
                    ...current,
                    scenes: !current.scenes,
                  }))
                }
              >
                {rootsOpen.scenes ? (
                  <ChevronDown aria-hidden />
                ) : (
                  <ChevronRight aria-hidden />
                )}
                <span>场景</span>
                <em>{scenes.filter((scene) => !scene.groupId).length}</em>
              </button>
              {rootsOpen.scenes
                ? visibleScenes
                    .filter((scene) => !scene.groupId)
                    .map((scene) =>
                      renderBrowserItem({ kind: "scene", id: scene.id }),
                    )
                : null}
            </section>

            <section>
              <button
                type="button"
                className="galgame-visual-tree-root"
                aria-label="剧情 CG"
                aria-expanded={rootsOpen.cgs}
                onClick={() =>
                  setRootsOpen((current) => ({
                    ...current,
                    cgs: !current.cgs,
                  }))
                }
              >
                {rootsOpen.cgs ? (
                  <ChevronDown aria-hidden />
                ) : (
                  <ChevronRight aria-hidden />
                )}
                <span>CG</span>
                <em>{cgs.length}</em>
              </button>
              {rootsOpen.cgs
                ? visibleCgs.map((cg) =>
                    renderBrowserItem({ kind: "cg", id: cg.id }),
                  )
                : null}
            </section>

            {groups.map((group) => {
              const groupScenes = scenes.filter(
                (scene) => scene.groupId === group.id,
              );
              const groupedScenes = visibleScenes.filter(
                (scene) => scene.groupId === group.id,
              );
              return (
                <section
                  key={group.id}
                  className="galgame-visual-custom-group"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dragged = draggedItem.current;
                    if (dragged?.kind === "scene")
                      moveScene(dragged.id, undefined, group.id);
                    draggedItem.current = undefined;
                  }}
                >
                  <div className="galgame-visual-tree-root">
                    <button
                      type="button"
                      aria-label={`${group.collapsed ? "展开" : "折叠"}${group.name}`}
                      onClick={() =>
                        onDocument({
                          ...document,
                          sceneGroups: groups.map((candidate) =>
                            candidate.id === group.id
                              ? {
                                  ...candidate,
                                  collapsed: !candidate.collapsed,
                                }
                              : candidate,
                          ),
                        })
                      }
                    >
                      {group.collapsed ? (
                        <ChevronRight aria-hidden />
                      ) : (
                        <ChevronDown aria-hidden />
                      )}
                    </button>
                    <i style={{ background: group.color }} />
                    <input
                      aria-label="分组名称"
                      value={group.name}
                      onChange={(event) =>
                        onDocument({
                          ...document,
                          sceneGroups: groups.map((candidate) =>
                            candidate.id === group.id
                              ? { ...candidate, name: event.target.value }
                              : candidate,
                          ),
                        })
                      }
                    />
                    <em>{groupScenes.length}</em>
                    <button
                      type="button"
                      aria-label={`删除分组 ${group.name}`}
                      onClick={() =>
                        onDocument({
                          ...document,
                          sceneGroups: groups.filter(
                            (candidate) => candidate.id !== group.id,
                          ),
                          scenes: scenes.map((scene) =>
                            scene.groupId === group.id
                              ? { ...scene, groupId: null }
                              : scene,
                          ),
                        })
                      }
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                  {!group.collapsed
                    ? groupedScenes.map((scene) =>
                        renderBrowserItem({ kind: "scene", id: scene.id }),
                      )
                    : null}
                </section>
              );
            })}

            {!visibleScenes.length && !visibleCgs.length ? (
              <p className="galgame-visual-tree-empty">
                {query ? "没有匹配的场景或 CG。" : "创建第一个场景或 CG。"}
              </p>
            ) : null}
          </div>
        </aside>

        <main className="galgame-visual-stage-panel">
          <header>
            <div>
              {selection && (selectedScene || selectedCg) ? (
                <InlineEditableName
                  key={`${selection.kind}-${selection.id}`}
                  value={title}
                  label={selectedScene ? "场景名称" : "CG 名称"}
                  onCommit={(name) => {
                    if (selectedScene) {
                      updateScene(selectedScene.id, (scene) => ({
                        ...scene,
                        name,
                      }));
                    } else if (selectedCg) {
                      updateCg(selectedCg.id, (cg) => ({ ...cg, name }));
                    }
                  }}
                  onEmpty={() => onNotice("名称不能为空。")}
                />
              ) : (
                <strong>{title}</strong>
              )}
              <span>
                {detailCount} {selectedScene ? "层" : "个差分"} · {canvasWidth}×
                {canvasHeight}
              </span>
            </div>
            <nav aria-label="舞台操作模式">
              <button
                type="button"
                className={stageMode === "preview" ? "active" : ""}
                onClick={() => setStageMode("preview")}
              >
                <Eye aria-hidden /> 视差预览
              </button>
              {selectedScene ? (
                <button
                  type="button"
                  className={stageMode === "layer" ? "active" : ""}
                  disabled={!selectedLayer}
                  onClick={() => setStageMode("layer")}
                >
                  <Move aria-hidden /> 图层定位
                </button>
              ) : null}
            </nav>
            <div className="galgame-visual-zoom-controls">
              <button
                type="button"
                aria-label="缩小舞台"
                onClick={() => zoomStage(camera.zoom - 0.1)}
              >
                <Minus aria-hidden />
              </button>
              <strong>{Math.round(camera.zoom * 100)}%</strong>
              <button
                type="button"
                aria-label="放大舞台"
                onClick={() => zoomStage(camera.zoom + 0.1)}
              >
                <Plus aria-hidden />
              </button>
              <button
                type="button"
                aria-label="复位舞台预览"
                onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}
              >
                <RotateCcw aria-hidden />
              </button>
            </div>
          </header>

          <div className="galgame-visual-stage-shell">
            <div
              ref={stageRef}
              className={`galgame-visual-stage is-${stageMode}`}
              style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
              data-empty={stageEmpty || undefined}
              onPointerDown={startStageDrag}
              onPointerMove={moveStageDrag}
              onPointerUp={finishStageDrag}
              onPointerCancel={finishStageDrag}
              onWheel={wheelStage}
            >
              {selectedScene ? (
                layers.map((layer, index) => {
                  if (isolatedLayerId && isolatedLayerId !== layer.id)
                    return null;
                  const asset = assetsById.get(layer.assetId);
                  const draft =
                    layerDraft?.layerId === layer.id ? layerDraft : layer;
                  const transform = `translate(${draft.offsetX}%, ${draft.offsetY}%) translate(${-camera.x / layer.distance}px, ${-camera.y / layer.distance}px) scale(${camera.zoom})`;
                  return (
                    <StoryAssetImage
                      key={layer.id}
                      fileId={asset?.fileId}
                      alt=""
                      className="galgame-visual-stage-layer"
                      style={{
                        zIndex: index,
                        transform,
                      }}
                      fallback={
                        <div
                          className="galgame-visual-stage-missing"
                          style={{ zIndex: index, transform }}
                        >
                          <MapPinned aria-hidden />
                          <span>{layer.name} · 素材缺失</span>
                        </div>
                      }
                    />
                  );
                })
              ) : selectedCg && selectedVariant ? (
                <StoryAssetImage
                  fileId={activeImage?.fileId}
                  alt={`${selectedCg.name} · ${selectedVariant.label}`}
                  className="galgame-visual-stage-layer is-cg"
                  style={{
                    transform: `translate(${-camera.x}px, ${-camera.y}px) scale(${camera.zoom})`,
                  }}
                  fallback={
                    <div
                      className="galgame-visual-stage-missing is-cg"
                      style={{
                        transform: `translate(${-camera.x}px, ${-camera.y}px) scale(${camera.zoom})`,
                      }}
                    >
                      <Images aria-hidden />
                      <span>{selectedVariant.label} · 素材缺失</span>
                    </div>
                  }
                />
              ) : null}
              {stageEmpty ? (
                <div className="galgame-visual-stage-empty">
                  {selectedScene ? (
                    <ImagePlus aria-hidden />
                  ) : (
                    <Images aria-hidden />
                  )}
                  <strong>
                    {selectedScene
                      ? "添加第一张图片即可创建场景图层"
                      : selectedCg
                        ? "添加第一张图片即可创建 CG 差分"
                        : "从左侧创建场景或 CG"}
                  </strong>
                  <span>支持工程素材与全局文件库中的图片。</span>
                </div>
              ) : null}
              {!stageEmpty ? (
                <span className="galgame-visual-camera-readout">
                  <MousePointer2 aria-hidden /> X {camera.x} · Y {camera.y} px ·
                  推拉 {camera.zoom.toFixed(2)}×
                </span>
              ) : null}
              {selectedScene && isolatedLayerId ? (
                <button
                  type="button"
                  className="galgame-visual-isolation"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setIsolatedLayerId(undefined)}
                >
                  <Eye aria-hidden /> 隔离 开
                </button>
              ) : null}
            </div>
            <small>
              {stageMode === "preview"
                ? "拖动舞台平移镜头 · 滚轮前后推拉 · 近层变化更大、远层更小"
                : "拖动选中的图层调整偏移 · 松开后自动保存"}
            </small>
          </div>
        </main>

        <aside className="galgame-visual-stack-panel">
          <header>
            <strong>{selectedScene ? "图层" : "差分"}</strong>
            <span>{detailCount}</span>
            <button
              type="button"
              aria-label={selectedScene ? "添加场景图层" : "添加差分"}
              disabled={!selection}
              onClick={() =>
                openPicker(selectedScene ? "scene-layer" : "cg-variant", "add")
              }
            >
              <Plus aria-hidden />
            </button>
          </header>
          <label className="galgame-visual-stack-search">
            <Search aria-hidden />
            <input
              aria-label="搜索图层或差分"
              value={layerQuery}
              placeholder={selectedScene ? "搜索图层…" : "搜索差分…"}
              onChange={(event) => setLayerQuery(event.target.value)}
            />
          </label>

          <div className="galgame-visual-stack-list">
            {selectedScene
              ? [...filteredLayers].reverse().map((layer) => {
                  const asset = assetsById.get(layer.assetId);
                  const index = layers.findIndex(
                    (item) => item.id === layer.id,
                  );
                  return (
                    <article
                      key={layer.id}
                      className={layer.id === selectedLayer?.id ? "active" : ""}
                      draggable
                      onDragStart={() =>
                        (draggedItem.current = {
                          kind: "scene",
                          id: `layer:${layer.id}`,
                        })
                      }
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        const dragged = draggedItem.current;
                        const layerId = dragged?.id.replace(/^layer:/, "");
                        if (layerId) reorderLayer(layerId, layer.id);
                        draggedItem.current = undefined;
                      }}
                      onClick={() => setSelectedLayerId(layer.id)}
                    >
                      <GripVertical aria-hidden />
                      <em>{String(index + 1).padStart(2, "0")}</em>
                      <span>
                        <StoryAssetImage
                          fileId={asset?.fileId}
                          alt=""
                          fallback={<MapPinned aria-hidden />}
                        />
                      </span>
                      <div>
                        <input
                          aria-label="图层名称"
                          value={layer.name}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            updateScene(selectedScene.id, (scene) => ({
                              ...scene,
                              layers: (scene.layers ?? []).map((candidate) =>
                                candidate.id === layer.id
                                  ? { ...candidate, name: event.target.value }
                                  : candidate,
                              ),
                            }))
                          }
                        />
                        <small>{asset?.fileId ?? "素材缺失"}</small>
                      </div>
                      <label onClick={(event) => event.stopPropagation()}>
                        <span>距离</span>
                        <input
                          aria-label={`图层 ${layer.name} 距离数值`}
                          type="number"
                          min="0.1"
                          max="100"
                          step="0.1"
                          value={layer.distance}
                          onChange={(event) =>
                            setLayerDistance(
                              layer.id,
                              Number(event.target.value),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={`隔离图层 ${layer.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setIsolatedLayerId((current) =>
                            current === layer.id ? undefined : layer.id,
                          );
                        }}
                      >
                        {isolatedLayerId === layer.id ? (
                          <Eye aria-hidden />
                        ) : (
                          <EyeOff aria-hidden />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`替换图层 ${layer.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedLayerId(layer.id);
                          openPicker("scene-layer", "replace");
                        }}
                      >
                        <FolderOpen aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除图层 ${layer.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateScene(selectedScene.id, (scene) => ({
                            ...scene,
                            layers: (scene.layers ?? []).filter(
                              (candidate) => candidate.id !== layer.id,
                            ),
                          }));
                        }}
                      >
                        <Trash2 aria-hidden />
                      </button>
                    </article>
                  );
                })
              : variants
                  .filter((variant) =>
                    variant.label
                      .toLocaleLowerCase("zh-CN")
                      .includes(layerQuery.trim().toLocaleLowerCase("zh-CN")),
                  )
                  .map((variant, index) => {
                    const asset = assetsById.get(variant.assetId);
                    const isDefault =
                      variant.id === selectedCg?.defaultVariantId;
                    return (
                      <article
                        key={variant.id}
                        className={`${variant.id === selectedVariant?.id ? "active " : ""}is-cg`}
                        draggable
                        onDragStart={() =>
                          (draggedItem.current = {
                            kind: "cg",
                            id: `variant:${variant.id}`,
                          })
                        }
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          const dragged = draggedItem.current;
                          const variantId = dragged?.id.replace(
                            /^variant:/,
                            "",
                          );
                          if (variantId) reorderVariant(variantId, variant.id);
                          draggedItem.current = undefined;
                        }}
                        onClick={() => setSelectedVariantId(variant.id)}
                      >
                        <GripVertical aria-hidden />
                        <em>{String(index + 1).padStart(2, "0")}</em>
                        <span>
                          <StoryAssetImage
                            fileId={asset?.fileId}
                            alt=""
                            fallback={<Images aria-hidden />}
                          />
                        </span>
                        <div>
                          <input
                            aria-label="差分名称"
                            value={variant.label}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              selectedCg &&
                              updateCg(selectedCg.id, (cg) => ({
                                ...cg,
                                variants: (cg.variants ?? []).map(
                                  (candidate) =>
                                    candidate.id === variant.id
                                      ? {
                                          ...candidate,
                                          label: event.target.value,
                                        }
                                      : candidate,
                                ),
                              }))
                            }
                          />
                          <small>
                            {isDefault ? "默认差分" : asset?.fileId}
                          </small>
                        </div>
                        <button
                          type="button"
                          aria-label={`设为默认差分 ${variant.label}`}
                          disabled={isDefault}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (selectedCg)
                              updateCg(selectedCg.id, (cg) => ({
                                ...cg,
                                defaultVariantId: variant.id,
                              }));
                          }}
                        >
                          <Check aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`替换差分 ${variant.label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedVariantId(variant.id);
                            openPicker("cg-variant", "replace");
                          }}
                        >
                          <FolderOpen aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label="删除差分"
                          title={`删除差分 ${variant.label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeVariant(variant);
                          }}
                        >
                          <Trash2 aria-hidden />
                        </button>
                      </article>
                    );
                  })}
          </div>

          <div className="galgame-visual-stack-actions">
            <button
              type="button"
              aria-label="素材库添加"
              disabled={!selection}
              onClick={() =>
                openPicker(selectedScene ? "scene-layer" : "cg-variant", "add")
              }
            >
              <FolderOpen aria-hidden /> 素材库添加
            </button>
            <button
              type="button"
              aria-label="导入图片"
              disabled={!selection || upload.isPending}
              onClick={() => {
                setPickerTarget({
                  kind: selectedScene ? "scene-layer" : "cg-variant",
                  mode: "add",
                });
                fileInput.current?.click();
              }}
            >
              <Upload aria-hidden />
              {upload.isPending ? "导入中…" : "导入图片"}
            </button>
          </div>
        </aside>

        <section className="galgame-visual-bottom-panel">
          <div className="galgame-visual-properties">
            <section>
              <header>
                {selectedScene ? (
                  <ImageIcon aria-hidden />
                ) : (
                  <Images aria-hidden />
                )}
                <strong>{selectedScene ? "场景属性" : "CG 属性"}</strong>
              </header>
              {selectedScene ? (
                <label>
                  <span>名称</span>
                  <input
                    aria-label="场景名称"
                    value={selectedScene.name}
                    onChange={(event) =>
                      updateScene(selectedScene.id, (scene) => ({
                        ...scene,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : selectedCg ? (
                <>
                  <label>
                    <span>名称</span>
                    <input
                      aria-label="CG 名称"
                      value={selectedCg.name}
                      onChange={(event) =>
                        updateCg(selectedCg.id, (cg) => ({
                          ...cg,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>说明</span>
                    <textarea
                      aria-label="CG 说明"
                      value={selectedCg.description}
                      onChange={(event) =>
                        updateCg(selectedCg.id, (cg) => ({
                          ...cg,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <p>
                    默认差分：
                    <strong>{defaultVariant?.label ?? "尚未绑定"}</strong>
                  </p>
                </>
              ) : (
                <p>从左侧选择或创建资源。</p>
              )}
            </section>

            <section className="galgame-visual-references">
              <header>
                <ExternalLink aria-hidden />
                <strong>引用位置</strong>
                <span>
                  {selectedScene ? sceneRefs.length : cgRefs.length} 处
                </span>
              </header>
              <div>
                {(selectedScene ? sceneRefs : cgRefs).map((reference) => (
                  <button
                    key={reference.blockId}
                    type="button"
                    onClick={() =>
                      onLocate(reference.fragmentId, reference.blockId)
                    }
                  >
                    {reference.chapter} · {reference.fragment} · Block{" "}
                    {reference.index + 1}
                  </button>
                ))}
                {(selectedScene ? sceneRefs : cgRefs).length === 0 ? (
                  <small>尚未在剧本中引用。</small>
                ) : null}
                {selectedScene && sceneRefs.length ? (
                  <small>场景仍被 Scene Block 引用，无法删除。</small>
                ) : null}
                {selectedCg && cgRefs.length ? (
                  <small>CG 仍被显示 CG Block 引用，无法删除。</small>
                ) : null}
              </div>
              <button
                type="button"
                className="danger"
                aria-label={selectedScene ? "删除场景" : "删除 CG"}
                disabled={
                  !selection ||
                  (selectedScene
                    ? Boolean(sceneRefs.length)
                    : Boolean(cgRefs.length))
                }
                onClick={removeSelectedVisual}
              >
                <Trash2 aria-hidden /> 删除{selectedScene ? "场景" : " CG"}
              </button>
            </section>
          </div>

          {selectedScene ? (
            <div className="galgame-visual-parameters">
              <nav aria-label="场景图层参数">
                <button
                  type="button"
                  className={bottomTab === "distance" ? "active" : ""}
                  onClick={() => setBottomTab("distance")}
                >
                  距离
                </button>
                <button
                  type="button"
                  className={bottomTab === "offset" ? "active" : ""}
                  onClick={() => setBottomTab("offset")}
                >
                  偏移
                </button>
              </nav>
              {bottomTab === "distance" ? (
                <div className="galgame-distance-editor">
                  <div ref={distanceAxisRef} className="galgame-distance-axis">
                    <i />
                    {layers.map((layer, index) => {
                      const value =
                        distanceDraft?.layerId === layer.id
                          ? distanceDraft.value
                          : layer.distance;
                      return (
                        <button
                          key={layer.id}
                          type="button"
                          role="slider"
                          aria-label={`${layer.name} 距离`}
                          aria-valuemin={0.1}
                          aria-valuemax={100}
                          aria-valuenow={value}
                          className={
                            layer.id === selectedLayer?.id ? "active" : ""
                          }
                          style={{
                            left: `${distancePercent(value)}%`,
                            top: `${18 + (index % 2) * 38}px`,
                          }}
                          onClick={() => setSelectedLayerId(layer.id)}
                          onPointerDown={(event) => {
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            setSelectedLayerId(layer.id);
                            setDistanceDraft({
                              layerId: layer.id,
                              value: distanceFromPointer(event.clientX),
                            });
                          }}
                          onPointerMove={(event) => {
                            if (
                              !event.currentTarget.hasPointerCapture(
                                event.pointerId,
                              )
                            )
                              return;
                            setDistanceDraft({
                              layerId: layer.id,
                              value: distanceFromPointer(event.clientX),
                            });
                          }}
                          onPointerUp={(event) => {
                            if (
                              event.currentTarget.hasPointerCapture(
                                event.pointerId,
                              )
                            )
                              event.currentTarget.releasePointerCapture(
                                event.pointerId,
                              );
                            const value = distanceFromPointer(event.clientX);
                            setDistanceDraft(undefined);
                            setLayerDistance(layer.id, value);
                          }}
                          onPointerCancel={(event) => {
                            if (
                              event.currentTarget.hasPointerCapture(
                                event.pointerId,
                              )
                            )
                              event.currentTarget.releasePointerCapture(
                                event.pointerId,
                              );
                            setDistanceDraft(undefined);
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key !== "ArrowLeft" &&
                              event.key !== "ArrowRight"
                            )
                              return;
                            event.preventDefault();
                            const step = layer.distance < 1 ? 0.1 : 0.5;
                            setLayerDistance(
                              layer.id,
                              layer.distance +
                                (event.key === "ArrowRight" ? step : -step),
                            );
                          }}
                        >
                          <span>
                            {index + 1} {layer.name} {value}×
                          </span>
                          <i />
                        </button>
                      );
                    })}
                    <small className="near">0.1× 近</small>
                    <small className="middle">5×</small>
                    <small className="far">100× 远</small>
                  </div>
                  <p>
                    左侧靠近镜头，右侧更远；距离越近，镜头移动造成的视差越明显。
                  </p>
                </div>
              ) : selectedLayer ? (
                <div className="galgame-offset-editor">
                  {(["offsetX", "offsetY"] as const).map((key) => (
                    <label key={key}>
                      <span>{key === "offsetX" ? "偏移 X" : "偏移 Y"}</span>
                      <input
                        aria-label={
                          key === "offsetX" ? "图层偏移 X" : "图层偏移 Y"
                        }
                        type="range"
                        min="-200"
                        max="200"
                        value={selectedLayer[key]}
                        onChange={(event) =>
                          updateScene(selectedScene.id, (scene) => ({
                            ...scene,
                            layers: (scene.layers ?? []).map((layer) =>
                              layer.id === selectedLayer.id
                                ? {
                                    ...layer,
                                    [key]: Number(event.target.value),
                                  }
                                : layer,
                            ),
                          }))
                        }
                      />
                      <input
                        aria-label={
                          key === "offsetX"
                            ? "图层偏移 X 数值"
                            : "图层偏移 Y 数值"
                        }
                        type="number"
                        min="-200"
                        max="200"
                        value={selectedLayer[key]}
                        onChange={(event) =>
                          updateScene(selectedScene.id, (scene) => ({
                            ...scene,
                            layers: (scene.layers ?? []).map((layer) =>
                              layer.id === selectedLayer.id
                                ? {
                                    ...layer,
                                    [key]: clamp(
                                      Number(event.target.value),
                                      -200,
                                      200,
                                    ),
                                  }
                                : layer,
                            ),
                          }))
                        }
                      />
                      <em>%</em>
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      updateScene(selectedScene.id, (scene) => ({
                        ...scene,
                        layers: (scene.layers ?? []).map((layer) =>
                          layer.id === selectedLayer.id
                            ? { ...layer, offsetX: 0, offsetY: 0 }
                            : layer,
                        ),
                      }))
                    }
                  >
                    <RotateCcw aria-hidden /> 复位偏移
                  </button>
                </div>
              ) : (
                <p className="galgame-visual-parameter-empty">
                  选择一个图层后调整偏移。
                </p>
              )}
            </div>
          ) : selectedCg ? (
            <div className="galgame-visual-cg-help">
              <Images aria-hidden />
              <strong>CG 差分</strong>
              <span>
                右侧管理画面差分和默认差分；实际出现、隐藏、适配与叠放位置仍由
                Show/Hide CG Block 控制。
              </span>
            </div>
          ) : null}
        </section>
      </div>

      <input
        ref={fileInput}
        hidden
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.avif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file && pickerTarget)
            upload.mutate({ file, target: pickerTarget });
        }}
      />

      {picker && pickerTarget ? (
        <StoryImagePicker
          projectId={projectId}
          state={picker}
          usedFileIds={usedFileIds}
          addTitle={
            pickerTarget.kind === "scene-layer"
              ? "添加场景图层"
              : "添加 CG 差分"
          }
          replaceTitle={
            pickerTarget.kind === "scene-layer"
              ? "替换场景图层"
              : "替换 CG 差分"
          }
          searchLabel={
            pickerTarget.kind === "scene-layer"
              ? "搜索场景图片"
              : "搜索 CG 素材"
          }
          projectEmptyCopy="工程中还没有可用图片。"
          onState={setPicker}
          onChoose={bindFile}
          onUpload={() => fileInput.current?.click()}
          onClose={() => {
            setPicker(undefined);
            setPickerTarget(undefined);
          }}
        />
      ) : null}

      {itemMenu && (menuScene || menuCg)
        ? createPortal(
            <div
              ref={menuRef}
              id="galgame-visual-item-menu"
              className="galgame-visual-item-menu"
              role="menu"
              aria-label={`${menuScene?.name ?? menuCg?.name} 操作`}
              style={{ left: itemMenu.left, top: itemMenu.top }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  selectVisual(itemMenu.item);
                  setItemMenu(undefined);
                }}
              >
                <Eye aria-hidden />
                打开{menuScene ? "场景" : " CG"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => beginRename(itemMenu.item)}
              >
                <Pencil aria-hidden />
                重命名
              </button>

              {menuScene ? (
                <>
                  <i aria-hidden />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!menuScene.groupId}
                    onClick={() => {
                      moveScene(menuScene.id, undefined, null);
                      setItemMenu(undefined);
                    }}
                  >
                    <Undo2 aria-hidden />
                    移出分组
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!menuScene.groupId}
                    onClick={() => {
                      moveScene(menuScene.id, undefined, null);
                      setItemMenu(undefined);
                    }}
                  >
                    {!menuScene.groupId ? (
                      <Check aria-hidden />
                    ) : (
                      <FolderOpen aria-hidden />
                    )}
                    移动到 场景
                  </button>
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      role="menuitem"
                      disabled={menuScene.groupId === group.id}
                      onClick={() => {
                        moveScene(menuScene.id, undefined, group.id);
                        setItemMenu(undefined);
                      }}
                    >
                      {menuScene.groupId === group.id ? (
                        <Check aria-hidden />
                      ) : (
                        <FolderOpen aria-hidden />
                      )}
                      移动到 {group.name}
                    </button>
                  ))}
                </>
              ) : null}

              <i aria-hidden />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  duplicateVisual(itemMenu.item);
                  setItemMenu(undefined);
                }}
              >
                <Copy aria-hidden />
                复制{menuScene ? "场景" : " CG"}
              </button>
              <i aria-hidden />
              <button
                type="button"
                className="danger"
                role="menuitem"
                disabled={menuReferences.length > 0}
                title={
                  menuReferences.length
                    ? menuScene
                      ? "场景仍被 Scene Block 引用，无法删除。"
                      : "CG 仍被显示 CG Block 引用，无法删除。"
                    : undefined
                }
                onClick={() => {
                  removeVisual(itemMenu.item);
                  setItemMenu(undefined);
                }}
              >
                <Trash2 aria-hidden />
                删除{menuScene ? "场景" : " CG"}
              </button>
            </div>,
            globalThis.document.body,
          )
        : null}
    </section>
  );
}
