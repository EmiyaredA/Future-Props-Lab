import { initializeCanvas, writePsd, type Layer } from "ag-psd";

type Source = {
  id: string;
  name: string;
  group: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  order: number;
  png: ArrayBuffer;
};

initializeCanvas(
  (width, height) =>
    new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement,
  (width, height) => new ImageData(width, height),
);

self.onmessage = async (
  event: MessageEvent<{ width: number; height: number; layers: Source[] }>,
) => {
  try {
    const { width, height, layers } = event.data;
    const children: Layer[] = [];
    const groups = new Map<string, Layer[]>();
    groups.set("", children);
    for (const source of [...layers].sort((a, b) => b.order - a.order)) {
      const image = await createImageBitmap(
        new Blob([source.png], { type: "image/png" }),
      );
      if (image.width !== source.width || image.height !== source.height)
        throw new Error(`${source.name}：素材尺寸与工程不一致`);
      const { width: imageWidth, height: imageHeight } = image;
      const canvas = new OffscreenCanvas(imageWidth, imageHeight);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建 PSD 图层画布");
      context.drawImage(image, 0, 0);
      image.close();
      let path = "";
      for (const segment of source.group.split("/").filter(Boolean)) {
        const next = path ? `${path}/${segment}` : segment;
        if (!groups.has(next)) {
          const group: Layer = { name: segment, children: [], opened: true };
          groups.get(path)!.push(group);
          groups.set(next, group.children!);
        }
        path = next;
      }
      groups.get(path)!.push({
        name: source.name,
        left: Math.round(source.x),
        top: Math.round(source.y),
        opacity: source.opacity,
        hidden: !source.visible,
        imageData: context.getImageData(0, 0, imageWidth, imageHeight),
      });
    }
    const data = writePsd({
      width,
      height,
      colorMode: 3,
      bitsPerChannel: 8,
      children,
    });
    self.postMessage({ data }, { transfer: [data] });
  } catch (exception) {
    self.postMessage({
      error: exception instanceof Error ? exception.message : "PSD 生成失败",
    });
  }
};
