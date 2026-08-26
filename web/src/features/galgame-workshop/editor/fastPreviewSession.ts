import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import type { FastPreviewCursor } from "@features/galgame-workshop/editor/FastPreviewWorkspace";
import type {
  FastPreviewDialogueEdit,
  FastPreviewDialogueEditResult,
} from "@features/galgame-workshop/editor/FastPreviewWorkspace";
import type { StoryPlayerPlaybackRange } from "@features/galgame-workshop/editor/storyPlayerModel";

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

export function openFastPreviewWindow({
  projectId,
  document,
  startCursor,
  playbackRange,
  storyRevision,
  exactFrameDisabledReason,
  latestDocument,
  applyDialogueEdit,
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
