import {
  createGenerationTask,
  type GenerationBatch,
  type VisualCanvasGenerationDraft,
} from "@features/visual-workshop/api";
import type { GenerationKind } from "@features/visual-workshop/generation/options";
import type { VisualCanvasNode, VisualCanvasEdge } from "../api";

export type CanvasReferenceContext = {
  removeEdge: (id: string) => void;
  nodes: VisualCanvasNode[];
  edges: VisualCanvasEdge[];
  replaceEdges: (
    update: (edges: VisualCanvasEdge[]) => VisualCanvasEdge[],
    immediate?: boolean,
  ) => void;
};
export type ResolvedCanvasInput = {
  key: string;
  edge: VisualCanvasEdge;
  title: string;
  kind: VisualCanvasNode["kind"];
  assetId?: string | null;
  text?: string | null;
  version?: number | null;
  error?: string;
  loading: boolean;
};

export type LinkedReferenceAssetIds = {
  image: string[];
  video: string[];
  audio: string[];
};

export type LinkedReferenceNames = Record<string, string>;

export type DesignReferenceRequest = {
  card: import("../creative/api").Card;
  handled: () => void;
};

export type GenerationDrawerProps = {
  referenceContext?: CanvasReferenceContext;
  referenceInputs?: ResolvedCanvasInput[];
  referencesReady?: boolean;
  designReferenceRequest?: DesignReferenceRequest;
  projectId: string;
  onClose: () => void;
  lockedKind?: GenerationKind;
  draft?: VisualCanvasGenerationDraft | null;
  onDraftChange?: (
    draft: VisualCanvasGenerationDraft,
    immediate?: boolean,
  ) => void;
  onBeforeSubmit?: () => Promise<number | void>;
  onTaskCreated?: (
    task: Awaited<ReturnType<typeof createGenerationTask>>,
  ) => void | Promise<void>;
  onBatchCreated?: (batch: GenerationBatch) => void | Promise<void>;
  compact?: boolean;
  layout?: "canvas" | "workbench";
  generating?: boolean;
  canvasNodeId?: string;
  excludedAssetIds?: string[];
  linkedAssetIds?: LinkedReferenceAssetIds;
  linkedReferenceNames?: LinkedReferenceNames;
};
