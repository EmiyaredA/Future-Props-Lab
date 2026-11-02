import type { TransferOptions } from "@platform/api/transfer";
import { fetchApiDownload } from "@platform/api/client";
import { visualAssetDownloadPath, type VisualCanvasNode } from "../api";

export async function downloadNodeOutput(
  node: VisualCanvasNode,
  transfer: TransferOptions = {},
) {
  const title = node.title.replace(/[\\/:*?"<>|]/g, "_") || "节点输出";
  if (node.kind === "text" ? !node.text?.trim() : !node.asset_id) {
    throw new Error("该节点暂无可下载内容");
  }
  const download =
    node.kind === "text"
      ? {
          blob: new Blob([node.text ?? ""], {
            type: "text/plain;charset=utf-8",
          }),
          filename: `${title}.txt`,
        }
      : transfer.onProgress
        ? await fetchApiDownload(
            visualAssetDownloadPath(node.asset_id!, title),
            transfer,
          )
        : await fetchApiDownload(
            visualAssetDownloadPath(node.asset_id!, title),
          );
  const url = URL.createObjectURL(download.blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = download.filename || title;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
