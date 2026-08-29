import {
  createGenerationTask,
  type VisualCanvasGenerationDraft,
} from "@features/visual-workshop/api";
import type { GenerationKind } from "@features/visual-workshop/generation/options";

export type GenerationDrawerProps = {
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
  compact?: boolean;
  canvasNodeId?: string;
};
