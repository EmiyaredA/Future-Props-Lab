import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import type { FastPreviewCursor } from "@features/galgame-workshop/editor/storyPlayerModel";
import type {
  FastPreviewDialogueEdit,
  FastPreviewDialogueEditResult,
} from "@features/galgame-workshop/editor/fastPreviewDialogueEdit";
import type {
  FastPreviewStageExpressionEdit,
  FastPreviewStageExpressionEditResult,
} from "@features/galgame-workshop/editor/fastPreviewStageExpressionEdit";
import type { StoryPlayerPlaybackRange } from "@features/galgame-workshop/editor/storyPlayerModel";
import type {
  FastPreviewStoryEdit,
  FastPreviewStoryEditResult,
} from "@features/galgame-workshop/editor/fastPreviewEdits";

export type FastPreviewDocumentMessage = {
  type: "document";
  document: GalgameStoryProject;
  startCursor: FastPreviewCursor;
  playbackRange?: StoryPlayerPlaybackRange;
  storyRevision?: number;
  exactFrameDisabledReason?: string;
  source: "launch" | "reload";
};

export type FastPreviewEditRequestMessage = {
  type: "edit-dialogue";
  requestId: string;
  edit: FastPreviewDialogueEdit;
};

export type FastPreviewEditResultMessage = {
  type: "edit-dialogue-result";
  requestId: string;
  result?: FastPreviewDialogueEditResult;
  error?: string;
};

export type FastPreviewStageExpressionRequestMessage = {
  type: "edit-stage-expression";
  requestId: string;
  edit: FastPreviewStageExpressionEdit;
};

export type FastPreviewStageExpressionResultMessage = {
  type: "edit-stage-expression-result";
  requestId: string;
  result?: FastPreviewStageExpressionEditResult;
  error?: string;
};

export type FastPreviewEditsRequestMessage = {
  type: "edit-batch";
  requestId: string;
  edits: FastPreviewStoryEdit[];
};

export type FastPreviewEditsResultMessage = {
  type: "edit-batch-result";
  requestId: string;
  result?: FastPreviewStoryEditResult;
  error?: string;
};

export function openFastPreviewWindow({
  projectId,
  document,
  startCursor,
  playbackRange,
  storyRevision,
  exactFrameDisabledReason,
  latestDocument,
  applyDialogueEdit,
  applyStageExpressionEdit,
  applyEdits,
}: {
  projectId: string;
  document: GalgameStoryProject;
  startCursor: FastPreviewCursor;
  playbackRange?: StoryPlayerPlaybackRange;
  storyRevision: number;
  exactFrameDisabledReason?: string;
  latestDocument: () => GalgameStoryProject;
  applyDialogueEdit: (
    edit: FastPreviewDialogueEdit,
  ) => Promise<FastPreviewDialogueEditResult>;
  applyStageExpressionEdit: (
    edit: FastPreviewStageExpressionEdit,
  ) => Promise<FastPreviewStageExpressionEditResult>;
  applyEdits: (
    edits: FastPreviewStoryEdit[],
  ) => Promise<FastPreviewStoryEditResult>;
}) {
  const sessionId = crypto.randomUUID();
  const channel = new BroadcastChannel(`fpl-galgame-preview:${sessionId}`);
  let currentRevision = storyRevision;
  const send = (source: "launch" | "reload") =>
    channel.postMessage({
      type: "document",
      document: structuredClone(
        source === "launch" ? document : latestDocument(),
      ),
      startCursor,
      playbackRange,
      storyRevision: currentRevision,
      exactFrameDisabledReason,
      source,
    } satisfies FastPreviewDocumentMessage);
  channel.addEventListener("message", (event) => {
    if (event.data?.type === "ready") send("launch");
    if (event.data?.type === "reload") send("reload");
    if (event.data?.type === "edit-dialogue") {
      const request = event.data as FastPreviewEditRequestMessage;
      void applyDialogueEdit(request.edit)
        .then((result) => {
          currentRevision = result.storyRevision;
          channel.postMessage({
            type: "edit-dialogue-result",
            requestId: request.requestId,
            result,
          } satisfies FastPreviewEditResultMessage);
        })
        .catch((error) =>
          channel.postMessage({
            type: "edit-dialogue-result",
            requestId: request.requestId,
            error: error instanceof Error ? error.message : "保存失败",
          } satisfies FastPreviewEditResultMessage),
        );
    }
    if (event.data?.type === "edit-stage-expression") {
      const request = event.data as FastPreviewStageExpressionRequestMessage;
      void applyStageExpressionEdit(request.edit)
        .then((result) => {
          currentRevision = result.storyRevision;
          channel.postMessage({
            type: "edit-stage-expression-result",
            requestId: request.requestId,
            result,
          } satisfies FastPreviewStageExpressionResultMessage);
        })
        .catch((error) =>
          channel.postMessage({
            type: "edit-stage-expression-result",
            requestId: request.requestId,
            error: error instanceof Error ? error.message : "保存失败",
          } satisfies FastPreviewStageExpressionResultMessage),
        );
    }
    if (event.data?.type === "edit-batch") {
      const request = event.data as FastPreviewEditsRequestMessage;
      void applyEdits(request.edits)
        .then((result) => {
          currentRevision = result.storyRevision;
          channel.postMessage({
            type: "edit-batch-result",
            requestId: request.requestId,
            result,
          } satisfies FastPreviewEditsResultMessage);
        })
        .catch((error) =>
          channel.postMessage({
            type: "edit-batch-result",
            requestId: request.requestId,
            error: error instanceof Error ? error.message : "保存失败",
          } satisfies FastPreviewEditsResultMessage),
        );
    }
  });
  const popup = window.open(
    `/apps/galgame-workshop/projects/${encodeURIComponent(projectId)}/preview?session=${encodeURIComponent(sessionId)}`,
    `galgame-preview-${sessionId}`,
    "popup,width=1500,height=920",
  );
  const monitor = window.setInterval(() => {
    if (popup && !popup.closed) return;
    window.clearInterval(monitor);
    channel.close();
  }, 1000);
}
