import { useTransferProgress } from "@platform/api/useTransferProgress";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  dialogueBoxPresetStyle,
  resolveDialogueBoxStyle,
  uploadGalgameProjectAsset,
  type GalgameStoryDialogueBoxStyle,
  type GalgameStoryProject,
  type GalgameStoryStageStyle,
  type GalgameStoryUiComponent,
} from "@features/galgame-workshop/api";
import {
  DEFAULT_DIALOGUE_BOX_STYLE,
  DEFAULT_STAGE_STYLE,
  DEFAULT_UI_STYLE,
  stableId,
} from "@features/galgame-workshop/editor/model";
import { type StoryImagePickerState } from "@features/galgame-workshop/editor/StoryImagePicker";
import { invalidateGalgameAssetQueries } from "@features/galgame-workshop/queryKeys";

type AssetTarget =
  { kind: "dialogueBox" } | { kind: "uiComponent"; componentId: string };

type PickerContext = {
  target: AssetTarget;
  label: string;
  state: StoryImagePickerState;
};

export function useDialogueStyleController({
  projectId,
  document,
  onDocument,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picker, setPicker] = useState<PickerContext>();
  const [uploadTarget, setUploadTarget] = useState<AssetTarget>();
  const [uploadError, setUploadError] = useState("");
  const style = resolveDialogueBoxStyle(
    document.presentation?.dialogueBox ?? DEFAULT_DIALOGUE_BOX_STYLE,
  );
  const uiStyle = {
    ...DEFAULT_UI_STYLE,
    ...document.presentation?.ui,
  };
  const stageStyle = {
    ...DEFAULT_STAGE_STYLE,
    ...document.presentation?.stage,
  };
  const dialogueAsset = (document.assets ?? []).find(
    (asset) => asset.id === style.assetId,
  );
  const usedFileIds = new Set(
    (document.assets ?? []).map((asset) => asset.fileId),
  );

  const updateStyle = (next: Partial<GalgameStoryDialogueBoxStyle>) => {
    onDocument({
      ...document,
      presentation: {
        ...document.presentation,
        dialogueBox: { ...style, ...next },
      },
    });
  };

  const updateLayout = (
    next: Partial<NonNullable<GalgameStoryDialogueBoxStyle["layout"]>>,
  ) => updateStyle({ preset: "custom", layout: { ...style.layout, ...next } });
  const updateBackground = (
    next: Partial<NonNullable<GalgameStoryDialogueBoxStyle["background"]>>,
  ) =>
    updateStyle({
      preset: "custom",
      background: { ...style.background, ...next },
    });
  const updateBody = (
    next: Partial<NonNullable<GalgameStoryDialogueBoxStyle["body"]>>,
  ) => updateStyle({ preset: "custom", body: { ...style.body, ...next } });
  const updateSpeakerName = (
    next: Partial<NonNullable<GalgameStoryDialogueBoxStyle["speakerName"]>>,
  ) =>
    updateStyle({
      preset: "custom",
      speakerName: { ...style.speakerName, ...next },
    });
  const updateAdvanceIndicator = (
    next: Partial<
      NonNullable<GalgameStoryDialogueBoxStyle["advanceIndicator"]>
    >,
  ) =>
    updateStyle({
      preset: "custom",
      advanceIndicator: { ...style.advanceIndicator, ...next },
    });

  const applyPreset = (
    preset: Exclude<GalgameStoryDialogueBoxStyle["preset"], "custom">,
  ) =>
    onDocument({
      ...document,
      presentation: {
        ...document.presentation,
        dialogueBox: dialogueBoxPresetStyle(preset),
      },
    });

  const updateStageStyle = (next: Partial<GalgameStoryStageStyle>) => {
    onDocument({
      ...document,
      presentation: {
        ...document.presentation,
        stage: { ...stageStyle, ...next },
      },
    });
  };

  const components = uiStyle.components ?? [];
  const componentById = (componentId: string) =>
    components.find((component) => component.id === componentId);
  const assetIdForTarget = (target: AssetTarget) =>
    target.kind === "dialogueBox"
      ? style.assetId
      : componentById(target.componentId)?.assetId;
  const selectedAssetForTarget = (target: AssetTarget) =>
    (document.assets ?? []).find(
      (asset) => asset.id === assetIdForTarget(target),
    );

  const updateComponents = (next: GalgameStoryUiComponent[]) => {
    onDocument({
      ...document,
      presentation: {
        ...document.presentation,
        dialogueBox: style,
        ui: { components: next },
      },
    });
  };

  const updateComponent = (
    componentId: string,
    next: Partial<GalgameStoryUiComponent>,
  ) =>
    updateComponents(
      components.map((component) =>
        component.id === componentId ? { ...component, ...next } : component,
      ),
    );

  const presentationWithAsset = (
    target: AssetTarget,
    assetId: string | null,
  ) =>
    target.kind === "dialogueBox"
      ? {
          ...document.presentation,
          dialogueBox: { ...style, assetId },
          ui: uiStyle,
        }
      : {
          ...document.presentation,
          dialogueBox: style,
          ui: {
            components: components.map((component) =>
              component.id === target.componentId
                ? { ...component, assetId }
                : component,
            ),
          },
        };

  const bindFile = (target: AssetTarget, fileId: string) => {
    const selectedAsset = selectedAssetForTarget(target);
    const assetId = selectedAsset?.id ?? stableId();
    onDocument({
      ...document,
      assets: selectedAsset
        ? (document.assets ?? []).map((asset) =>
            asset.id === selectedAsset.id ? { ...asset, fileId } : asset,
          )
        : [
            ...(document.assets ?? []),
            {
              id: assetId,
              type: "image",
              role:
                target.kind === "dialogueBox" ? "dialogueBox" : "uiComponent",
              fileId,
              status: "ready",
            },
          ],
      presentation: presentationWithAsset(target, assetId),
    });
    setPicker(undefined);
    setUploadTarget(undefined);
  };

  const upload = useMutation({
    mutationFn: ({ file }: { file: File; target: AssetTarget }) =>
      runTransfer((onProgress) =>
        uploadGalgameProjectAsset(projectId, file, undefined, { onProgress }),
      ),
    onSuccess: (asset, variables) => {
      setUploadError("");
      void invalidateGalgameAssetQueries(client, projectId);
      bindFile(variables.target, asset.id);
    },
    onError: (caught) =>
      setUploadError(caught instanceof Error ? caught.message : "图片上传失败"),
  });

  const targetLabel = (target: AssetTarget) =>
    target.kind === "dialogueBox"
      ? "对话框底图"
      : componentById(target.componentId)?.name || "界面组件";

  const openUpload = (target: AssetTarget) => {
    const selectedAsset = selectedAssetForTarget(target);
    const label = targetLabel(target);
    setUploadTarget(target);
    setPicker({
      target,
      label,
      state: {
        mode: selectedAsset ? "replace" : "add",
        source: "project",
      },
    });
    requestAnimationFrame(() => fileInput.current?.click());
  };

  const openLibrary = (target: AssetTarget) => {
    const selectedAsset = selectedAssetForTarget(target);
    const label = targetLabel(target);
    setPicker({
      target,
      label,
      state: {
        mode: selectedAsset ? "replace" : "add",
        source: "library",
      },
    });
  };

  const removeImage = (target: AssetTarget) => {
    const selectedAsset = selectedAssetForTarget(target);
    if (!selectedAsset) return;
    const usedByAnotherComponent =
      target.kind === "uiComponent" &&
      components.some(
        (component) =>
          component.id !== target.componentId &&
          component.assetId === selectedAsset.id,
      );
    onDocument({
      ...document,
      assets: usedByAnotherComponent
        ? document.assets
        : (document.assets ?? []).filter(
            (asset) => asset.id !== selectedAsset.id,
          ),
      presentation: presentationWithAsset(target, null),
    });
  };

  const addComponent = () => {
    const count = components.length + 1;
    updateComponents([
      ...components,
      {
        id: stableId(),
        name: `界面组件 ${count}`,
        assetId: null,
        x: 4,
        y: 4,
        width: 24,
        visibility: "always",
        layer: 1,
      },
    ]);
  };

  const removeComponent = (componentId: string) => {
    const component = componentById(componentId);
    const assetUsedElsewhere = components.some(
      (candidate) =>
        candidate.id !== componentId &&
        candidate.assetId === component?.assetId,
    );
    onDocument({
      ...document,
      assets:
        component?.assetId && !assetUsedElsewhere
          ? (document.assets ?? []).filter(
              (asset) => asset.id !== component.assetId,
            )
          : document.assets,
      presentation: {
        ...document.presentation,
        dialogueBox: style,
        ui: {
          components: components.filter(
            (candidate) => candidate.id !== componentId,
          ),
        },
      },
    });
  };

  const resetStyle = () => {
    onDocument({
      ...document,
      assets: dialogueAsset
        ? (document.assets ?? []).filter(
            (asset) => asset.id !== dialogueAsset.id,
          )
        : document.assets,
      presentation: {
        ...document.presentation,
        dialogueBox: dialogueBoxPresetStyle("dark"),
        ui: uiStyle,
      },
    });
  };

  return {
    transferProgress: activeTransferProgress,
    projectId,
    document,
    onDocument,
    fileInput,
    picker,
    setPicker,
    uploadTarget,
    setUploadTarget,
    uploadError,
    style,
    uiStyle,
    stageStyle,
    dialogueAsset,
    usedFileIds,
    updateStyle,
    updateLayout,
    updateBackground,
    updateBody,
    updateSpeakerName,
    updateAdvanceIndicator,
    applyPreset,
    updateStageStyle,
    components,
    componentById,
    assetIdForTarget,
    selectedAssetForTarget,
    updateComponents,
    updateComponent,
    presentationWithAsset,
    bindFile,
    upload,
    targetLabel,
    openUpload,
    openLibrary,
    removeImage,
    addComponent,
    removeComponent,
    resetStyle,
  };
}
