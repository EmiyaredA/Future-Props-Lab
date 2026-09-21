import type { PsdResult } from "./psd.worker";
export async function parsePsd(
  file: File,
  signal?: AbortSignal,
): Promise<PsdResult> {
  const worker = new Worker(new URL("./psd.worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    const bytes = await file.arrayBuffer();
    return await new Promise((resolve, reject) => {
      const stop = () => {
        worker.terminate();
        reject(new Error("素材导入已取消"));
      };
      if (signal?.aborted) {
        stop();
        return;
      }
      signal?.addEventListener("abort", stop, { once: true });
      worker.onmessage = (e) => {
        signal?.removeEventListener("abort", stop);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data);
      };
      worker.onerror = () => {
        signal?.removeEventListener("abort", stop);
        reject(new Error("PSD 解析失败"));
      };
      worker.postMessage(bytes, [bytes]);
    });
  } finally {
    worker.terminate();
  }
}
