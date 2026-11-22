import type { ReactNode } from "react";
import type { WorkbenchView } from "../ProjectCreativeTools";
import type { WorkbenchSection } from "./MaterialViews";
import type { StoryboardWorkbench } from "../storyboard/workbench";
import type { useVisualCanvasController } from "../canvas/useVisualCanvasController";
import type {
  GenerationTask,
  GenerationBatch,
  VisualCanvasNode,
  VisualNodeOutput,
} from "../api";
import { nodeGenerationActivity } from "../generation/generationActivityModel";

export type BoardController = Pick<
  ReturnType<typeof useVisualCanvasController>,
  | "applyServerCanvas"
  | "assetTab"
  | "assetView"
  | "assetsOpen"
  | "canvasQuery"
  | "canvasReady"
  | "client"
  | "conflict"
  | "createMediaNodeFromAsset"
  | "createNode"
  | "edges"
  | "editingTitle"
  | "getInsertionAnchor"
  | "nodes"
  | "onBack"
  | "replaceEdges"
  | "removeEdge"
  | "linkGenerationTask"
  | "patchNode"
  | "prepareCanvasForAgent"
  | "projectCardIds"
  | "projectId"
  | "projectQuery"
  | "readCanvas"
  | "removeNode"
  | "renameMutation"
  | "replaceProjectCardIds"
  | "registerReferenceImage"
  | "resolveConflict"
  | "saveMessage"
  | "saveState"
  | "selectedId"
  | "setAssetTab"
  | "setAssetView"
  | "setAssetsOpen"
  | "setEditingTitle"
  | "setSelectedId"
  | "setSelectedNodeIds"
  | "setTitle"
  | "title"
  | "upload"
  | "uploadNotice"
  | "uploadPosition"
>;
export const nodeTypeNames = {
  text: "文本",
  image: "图像",
  audio: "音频",
  video: "视频",
};
export const boardStatuses = ["待准备", "可生成", "生成中", "已完成"] as const;
export type BoardStatus = (typeof boardStatuses)[number];

export function nodeStatus(
  node: VisualCanvasNode,
  tasks: GenerationTask[],
  upstreamReady: boolean,
  batches: GenerationBatch[] = [],
): BoardStatus {
  if (nodeGenerationActivity(node, tasks, batches)) return "生成中";
  const batch = batches.find(
    (batch) => node.kind === "image" && batch.id === node.generation_batch_id,
  );
  if (batch?.status === "failed") return upstreamReady ? "可生成" : "待准备";
  const task =
    node.kind === "text"
      ? undefined
      : tasks.find((task) => task.id === node.generation_task_id);
  if (task?.status === "failed") return upstreamReady ? "可生成" : "待准备";
  if (node.final_output_id || (node.kind !== "text" && node.asset_id))
    return "已完成";
  if (node.kind === "text") return node.text?.trim() ? "可生成" : "待准备";
  return node.generation_draft?.model_id &&
    node.generation_draft.prompt?.trim() &&
    upstreamReady
    ? "可生成"
    : "待准备";
}

export type ProjectBoardProps = {
  embedded?: boolean;
  view?: WorkbenchView;
  onView?: (view: WorkbenchView) => void;
  canvasContent?: ReactNode;
  section?: WorkbenchSection;
  onSection?: (section: WorkbenchSection) => void;
  storyboard?: StoryboardWorkbench;
  controller: BoardController & { revealNode?: (id: string) => void };
  onCanvas: () => void;
  onPrevis?: (sceneId?: string) => void;
  onScript?: (sceneId?: string) => void;
  onStoryboard?: () => void;
  previews: Record<string, VisualNodeOutput | undefined>;
  onPreview: (nodeId: string, version?: VisualNodeOutput) => void;
};
