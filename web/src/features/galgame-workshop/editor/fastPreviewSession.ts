import type { GalgameStoryProject } from "@features/galgame-workshop/api";
import type { FastPreviewCursor } from "@features/galgame-workshop/editor/FastPreviewWorkspace";

export type FastPreviewDocumentMessage = {
  type: "document";
  document: GalgameStoryProject;
  startCursor: FastPreviewCursor;
  source: "launch" | "reload";
};

export function openFastPreviewWindow({
  projectId,
  document,
  startCursor,
  latestDocument,
}: {
  projectId: string;
  document: GalgameStoryProject;
  startCursor: FastPreviewCursor;
  latestDocument: () => GalgameStoryProject;
}) {
  const sessionId = crypto.randomUUID();
  const channel = new BroadcastChannel(`fpl-galgame-preview:${sessionId}`);
  const send = (source: "launch" | "reload") =>
    channel.postMessage({
      type: "document",
      document: structuredClone(
        source === "launch" ? document : latestDocument(),
      ),
      startCursor,
      source,
    } satisfies FastPreviewDocumentMessage);
  channel.addEventListener("message", (event) => {
    if (event.data?.type === "ready") send("launch");
    if (event.data?.type === "reload") send("reload");
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
