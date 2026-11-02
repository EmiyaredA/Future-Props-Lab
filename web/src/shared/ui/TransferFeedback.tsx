import type { TransferProgress } from "@platform/api/transfer";
import { LoadingState } from "./LoadingState";

/** Render next to the action; the action's owner clears progress when it settles. */
export function TransferFeedback({
  progress,
}: {
  progress?: TransferProgress;
}) {
  return progress && progress.phase !== "completed" ? (
    <LoadingState
      progress={progress}
      label={progress.direction === "upload" ? "正在上传…" : "正在下载…"}
    />
  ) : null;
}
