import { initializeCanvas, readPsd, type Layer } from "ag-psd";
export type ImportedLayer = {
  name: string;
  group: string;
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
  blob: Blob;
};
export type PsdResult = {
  width: number;
  height: number;
  layers: ImportedLayer[];
  error?: string;
};
initializeCanvas(
  (w, h) => new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement,
  (w, h) => new ImageData(w, h),
);
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const buffer = event.data,
      view = new DataView(buffer);
    if (buffer.byteLength > 128 * 1024 * 1024 || buffer.byteLength < 26)
      throw new Error("PSD 大小无效或超过 128 MiB");
    if (view.getUint32(0) !== 0x38425053 || view.getUint16(4) !== 1)
      throw new Error("只支持 PSD；PSB 或损坏文件暂不支持");
    if (view.getUint16(22) !== 8 || view.getUint16(24) !== 3)
      throw new Error("请先将 PSD 转为 RGB 8 位");
    if (Math.max(view.getUint32(14), view.getUint32(18)) > 4096)
      throw new Error("PSD 画布边长不能超过 4096");
    const psd = readPsd(buffer, {
      useImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });
    const layers: ImportedLayer[] = [],
      issues: string[] = [];
    let pixels = 0;
    const visit = async (
      nodes: Layer[],
      group: string,
      opacity: number,
      visible: boolean,
    ) => {
      for (const node of nodes) {
        const name = node.name || "未命名部件",
          full = group ? `${group}/${name}` : name;
        if (
          node.adjustment ||
          node.effects ||
          node.vectorMask ||
          node.text ||
          node.placedLayer ||
          node.clipping ||
          (node.blendMode &&
            !["normal", "pass through"].includes(node.blendMode))
        )
          issues.push(
            `${full}：包含首版无法还原的效果、文字、剪贴或混合模式，请先栅格化`,
          );
        if (node.children) {
          if (node.opacity != null && node.opacity !== 1)
            issues.push(`${full}：分组透明度需要合成，请先应用到栅格图层`);
          if (node.mask) issues.push(`${full}：分组遮罩请先应用到各图层`);
          await visit(
            node.children,
            full,
            opacity * (node.opacity ?? 1),
            visible && !node.hidden,
          );
          continue;
        }
        const data = node.imageData;
        if (!data || !data.width || !data.height) continue;
        pixels += data.width * data.height;
        if (layers.length >= 128 || pixels > 64_000_000)
          throw new Error("PSD 超过 128 图层或 6400 万解码像素");
        const rgba = new Uint8ClampedArray(data.data);
        const mask = node.mask;
        if (mask && !mask.disabled) {
          if (
            mask.userMaskDensity != null ||
            mask.userMaskFeather ||
            mask.positionRelativeToLayer
          )
            issues.push(
              `${full}：遮罩密度、羽化或相对位置暂不支持，请先应用遮罩`,
            );
          const md = mask.imageData;
          for (let y = 0; y < data.height; y++)
            for (let x = 0; x < data.width; x++) {
              const mx = x + (node.left ?? 0) - (mask.left ?? 0),
                my = y + (node.top ?? 0) - (mask.top ?? 0);
              const a =
                md && mx >= 0 && my >= 0 && mx < md.width && my < md.height
                  ? md.data[(my * md.width + mx) * 4]
                  : (mask.defaultColor ?? 0);
              rgba[(y * data.width + x) * 4 + 3] = Math.round(
                (rgba[(y * data.width + x) * 4 + 3] * a) / 255,
              );
            }
        }
        const canvas = new OffscreenCanvas(data.width, data.height);
        canvas
          .getContext("2d")!
          .putImageData(new ImageData(rgba, data.width, data.height), 0, 0);
        layers.push({
          name,
          group,
          x: node.left ?? 0,
          y: node.top ?? 0,
          opacity: opacity * (node.opacity ?? 1),
          visible: visible && !node.hidden,
          blob: await canvas.convertToBlob({ type: "image/png" }),
        });
      }
    };
    await visit(psd.children ?? [], "", 1, true);
    if (issues.length)
      throw new Error(`导入已停止，未上传素材：\n${issues.join("\n")}`);
    if (!layers.length) throw new Error("PSD 中没有可导入的像素图层");
    self.postMessage({
      width: psd.width,
      height: psd.height,
      layers,
    } satisfies PsdResult);
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "PSD 解析失败",
    });
  }
};
