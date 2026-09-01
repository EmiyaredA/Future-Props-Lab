import { FrameExportDialog } from "@shared/ui/FrameExportDialog";
import { captureVideoFrame } from "@shared/media/videoFrameExport";
import type { VisualCanvasNode } from "@features/visual-workshop/api";

export type VisualCanvasFrameExport = {
  node: Extract<VisualCanvasNode, { kind: "video" }>;
  video: HTMLVideoElement;
  capturedAt: number;
};

export function VisualCanvasFrameExportDialog({
  frameExport,
  onClose,
  onSave,
}: {
  frameExport: VisualCanvasFrameExport;
  onClose: () => void;
  onSave: (file: File) => Promise<void>;
}) {
  const { capturedAt, node, video } = frameExport;
  const duration = Number.isFinite(video.duration)
    ? Math.max(0, video.duration)
    : capturedAt;
  const maxTime = Math.max(0, duration - 0.001);
  const restoreAndClose = () => {
    video.pause();
    if (Number.isFinite(capturedAt)) video.currentTime = capturedAt;
    onClose();
  };
  return (
    <FrameExportDialog
      baseName={`${node.title}-frame`}
      destination="下载到本机，并在源视频右侧创建图片节点"
      initialTime={capturedAt}
      maxTime={maxTime}
      step={0.001}
      loadSnapshot={(time, signal) => captureVideoFrame(video, time, signal)}
      onClose={restoreAndClose}
      onSave={onSave}
    />
  );
}
