import { renderToStaticMarkup } from "react-dom/server";
import { fetchApiBlob } from "@platform/api/client";
import { download } from "../download";
import { CanvasSvg } from "./CanvasSvg";
import { canvasAssetIds, type CanvasScene } from "./model";
const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
export async function canvasSvgText(
  scene: CanvasScene,
  assetUrl = (id: string) => `/v1/files/${encodeURIComponent(id)}/content`,
) {
  const images: Record<string, string> = {};
  await Promise.all(
    canvasAssetIds(scene).map(async (id) => {
      images[id] = await dataUrl(await fetchApiBlob(assetUrl(id)));
    }),
  );
  return renderToStaticMarkup(<CanvasSvg scene={scene} images={images} />);
}
export async function exportDiagram(
  svg: string,
  title: string,
  format: "svg" | "png",
) {
  const name = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "图表";
  if (format === "svg") {
    download(new Blob([svg], { type: "image/svg+xml" }), `${name}.svg`);
    return;
  }
  const parsed = new DOMParser().parseFromString(
    svg,
    "image/svg+xml",
  ).documentElement;
  const box = parsed.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
  const w = box?.[2] || 1200,
    h = box?.[3] || 800;
  const scale = Math.min(2, 8192 / w, 8192 / h);
  parsed.setAttribute("width", String(w * scale));
  parsed.setAttribute("height", String(h * scale));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(parsed)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建图片");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("图片导出失败"))),
        "image/png",
      ),
    );
    download(blob, `${name}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
