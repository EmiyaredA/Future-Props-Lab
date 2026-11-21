import type {
  GenerationOptions,
  VisualCanvasNode,
  VisualCanvasVideoGenerationDraft,
} from "../api";
/** Replace one explicit input in place. Prompts and all other input slots are preserved. */
export function adoptReferenceDraft(
  node: VisualCanvasNode,
  kind: "image" | "video",
  assetId: string,
  replace: string,
  options: GenerationOptions,
  linked: string[] = [],
) {
  if (node.kind !== "image" && node.kind !== "video")
    throw new Error("请选择图像或视频制作节点");
  const draft = node.generation_draft;
  if (!draft) throw new Error("请先为制作节点选择模型");
  const model = options.models.find(
    (item) => item.id === draft.model_id && item.kind === node.kind,
  );
  if (!model) throw new Error("当前模型不可用，请返回分镜选择模型");
  if (node.kind === "image" && kind !== "image")
    throw new Error("图像模型不能接收预演视频");
  const video =
    node.kind === "video"
      ? (draft as VisualCanvasVideoGenerationDraft)
      : undefined;
  const caps = model.workflow_capabilities ?? model.video_capabilities;
  if (
    video &&
    model.video_capabilities?.supported_modes?.length &&
    !model.video_capabilities.supported_modes.includes("reference")
  )
    throw new Error("当前视频模型不支持参考素材，请返回分镜更换模型");
  const supportedMimes =
    node.kind === "image"
      ? model.reference_mime_types
      : caps?.reference_mime_types?.[kind];
  const limit =
    node.kind === "image"
      ? model.max_reference_images
      : (caps?.reference_limits?.[kind] ?? 0);
  const references = [
    ...new Set(
      kind === "video"
        ? (video?.video_asset_ids ?? [])
        : [
            ...("reference_asset_id" in draft && draft.reference_asset_id
              ? [draft.reference_asset_id]
              : []),
            ...(draft.reference_asset_ids ?? []),
          ],
    ),
  ];
  if (replace && !references.includes(replace))
    throw new Error("待替换素材已变化，请重新选择");
  const next = replace
    ? references.map((id) => (id === replace ? assetId : id))
    : [...references, assetId];
  if (new Set([...next, ...linked]).size > limit)
    throw new Error(
      `当前模型最多接收 ${limit} 个${kind === "image" ? "图片" : "视频"}参考，请替换已有素材或更换模型`,
    );
  const result =
    kind === "video"
      ? { ...draft, video_asset_ids: next }
      : { ...draft, reference_asset_id: null, reference_asset_ids: next };
  return {
    draft: {
      ...result,
      ...(video
        ? {
            mode: "reference" as const,
            reference_order: video.reference_order?.map((key) =>
              key === `asset:${replace}` ? `asset:${assetId}` : key,
            ),
            reference_subjects: video.reference_subjects
              ? Object.fromEntries(
                  Object.entries(video.reference_subjects).map(
                    ([key, value]) => [
                      key === `asset:${replace}` ? `asset:${assetId}` : key,
                      value,
                    ],
                  ),
                )
              : video.reference_subjects,
            design_references: video.design_references?.filter(
              (item) => item.asset_id !== replace,
            ),
          }
        : {}),
    },
    supportedMimes,
  };
}
