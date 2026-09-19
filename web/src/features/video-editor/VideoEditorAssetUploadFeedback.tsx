import type { VideoEditorAssetFolder } from "./types";

export type PendingFolderPlacement = {
  folderId: string;
  ids: string[];
};

export function VideoEditorAssetUploadFeedback({
  pending,
  progress,
  result,
  placements,
  folders,
  onRetry,
}: {
  pending: boolean;
  progress: { completed: number; total: number; filename: string };
  result?: {
    succeeded: number;
    failures: { filename: string; message: string }[];
  };
  placements: PendingFolderPlacement[];
  folders: VideoEditorAssetFolder[];
  onRetry: (placement: PendingFolderPlacement) => void;
}) {
  return (
    <>
      {pending || result ? (
        <div className="ve-upload-feedback">
          <p role="status">
            {pending
              ? `正在上传 ${progress.completed}/${progress.total}：${progress.filename}`
              : `上传完成：成功 ${result!.succeeded} 个${result!.failures.length ? `，失败 ${result!.failures.length} 个` : ""}`}
          </p>
          {!pending && result?.failures.length ? (
            <ul role="alert">
              {result.failures.map((failure, index) => (
                <li key={index}>
                  {failure.filename}：{failure.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {placements.map((placement) => (
        <button
          key={placement.ids.join(",")}
          type="button"
          className="ve-upload-retry"
          onClick={() => onRetry(placement)}
        >
          重试将 {placement.ids.length} 个素材归入“
          {folders.find((folder) => folder.id === placement.folderId)?.name ??
            "原文件夹"}
          ”
        </button>
      ))}
    </>
  );
}
