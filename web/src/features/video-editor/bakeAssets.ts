import { apiErrorMessage } from "@platform/api/errors";
import { createVideoEditorAssetBake, getVideoEditorAssetBake } from "./api";
import type { VideoEditorAsset } from "./types";

/** Bake only ready visual assets with a configured chroma key. Never resubmit a failed task. */
export async function bakeSelectedAssets(
  projectId: string,
  selectedAssets: VideoEditorAsset[],
  report: (message: string) => void,
): Promise<boolean> {
  const candidates = selectedAssets.filter(
    (asset) => asset.mediaKind === "video" || asset.mediaKind === "image",
  );
  const skippedKind = selectedAssets.length - candidates.length;
  const notReady = candidates.filter(
    (asset) => asset.processingStatus !== "ready",
  );
  const missingChroma = candidates.filter(
    (asset) =>
      asset.processingStatus === "ready" &&
      !asset.defaultEffects?.chromaKey?.enabled,
  );
  const targets = candidates.filter(
    (asset) =>
      asset.processingStatus === "ready" &&
      asset.defaultEffects?.chromaKey?.enabled,
  );
  if (!targets.length) {
    const reasons = [
      skippedKind ? `${skippedKind} 个类型不支持` : "",
      notReady.length ? `${notReady.length} 个尚未就绪` : "",
      missingChroma.length
        ? `${missingChroma.length} 个未设置启用中的默认抠像`
        : "",
    ].filter(Boolean);
    report(
      reasons.length
        ? `没有可烘焙的素材（${reasons.join("，")}）`
        : "没有可烘焙的素材",
    );
    return false;
  }
  const failed: string[] = [];
  let completed = 0;
  for (const [index, asset] of targets.entries()) {
    report(`正在烘焙 ${index + 1} / ${targets.length}`);
    try {
      let task = await createVideoEditorAssetBake(
        projectId,
        asset.id,
        asset.revision ?? 0,
      );
      while (task.status === "queued" || task.status === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        task = await getVideoEditorAssetBake(projectId, task.id);
      }
      if (task.status !== "completed") {
        failed.push(
          `${asset.displayName}：${task.error || task.status || "烘焙失败"}`,
        );
        continue;
      }
      completed += 1;
    } catch (error) {
      failed.push(
        `${asset.displayName}：${apiErrorMessage(error, "烘焙失败")}`,
      );
    }
  }
  const parts = [`已烘焙 ${completed} 个素材`];
  const skipped = skippedKind + notReady.length + missingChroma.length;
  if (skipped) parts.push(`跳过 ${skipped} 个`);
  if (failed.length) parts.push(`失败：${failed.slice(0, 3).join("；")}`);
  report(parts.join("。"));
  return true;
}
