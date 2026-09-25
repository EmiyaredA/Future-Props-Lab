import { strToU8, zipSync } from "fflate";
import { fetchApiBlob } from "@platform/api/client";
import { listAssets } from "./api";
import {
  exportCubismExpression,
  exportCubismMotion,
} from "./cubismInterchange";
import type { CharacterDocument } from "./types";

const safe = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

function writePsdInWorker(
  doc: CharacterDocument,
  layers: Array<Record<string, unknown> & { png: ArrayBuffer }>,
): Promise<ArrayBuffer> {
  const worker = new Worker(new URL("./psdExport.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    worker.onmessage = (
      event: MessageEvent<{ data?: ArrayBuffer; error?: string }>,
    ) => {
      worker.terminate();
      if (event.data.data) resolve(event.data.data);
      else reject(new Error(event.data.error || "PSD 生成失败"));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "PSD 工作线程失败"));
    };
    worker.postMessage({ width: doc.width, height: doc.height, layers });
  });
}

export async function buildCubismHandoff(
  projectId: string,
  doc: CharacterDocument,
): Promise<{ blob: Blob; warnings: string[] }> {
  if (!doc.parts.length) throw new Error("请先导入角色图层");
  const assets = await listAssets(projectId);
  const urls = new Map(assets.items.map((item) => [item.id, item.url]));
  const layers = await Promise.all(
    doc.parts.map(async (part) => {
      const url = urls.get(part.assetId);
      if (!url) throw new Error(`${part.name}：原始 PNG 素材缺失`);
      return { ...part, png: await (await fetchApiBlob(url)).arrayBuffer() };
    }),
  );
  const files: Record<string, Uint8Array> = {};
  const warnings: string[] = [];
  for (const [index, layer] of layers.entries())
    files[
      `layers/${String(index + 1).padStart(3, "0")}-${safe(layer.name)}-${safe(layer.id)}.png`
    ] = new Uint8Array(layer.png);
  for (const motion of doc.motions) {
    try {
      files[`motions/${safe(motion.name)}-${safe(motion.id)}.motion3.json`] =
        strToU8(JSON.stringify(exportCubismMotion(doc, motion), null, 2));
    } catch (exception) {
      warnings.push(
        `${motion.name}：${exception instanceof Error ? exception.message : "无法交换"}`,
      );
    }
  }
  for (const expression of doc.expressions) {
    try {
      files[
        `expressions/${safe(expression.name)}-${safe(expression.id)}.exp3.json`
      ] = strToU8(
        JSON.stringify(exportCubismExpression(doc, expression), null, 2),
      );
    } catch (exception) {
      warnings.push(
        `${expression.name}：${exception instanceof Error ? exception.message : "无法交换"}`,
      );
    }
  }
  files["README.txt"] = strToU8(
    `FPL 原生角色的 Cubism 素材交接包。先把 character-import.psd 导入 Cubism Editor，重新制作网格与参数绑定。此包不包含 .cmo3、.moc3 或可运行的 Cubism 模型。动作与表情文件仅适用于具有相同参数 ID 的 Cubism 模型。\n${warnings.length ? `\n未导出的参数预设：\n${warnings.join("\n")}\n` : ""}`,
  );
  files["character-import.psd"] = new Uint8Array(
    await writePsdInWorker(doc, layers),
  );
  return {
    blob: new Blob([zipSync(files, { level: 4 })], { type: "application/zip" }),
    warnings,
  };
}

export function saveHandoff(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
