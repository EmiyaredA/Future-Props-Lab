import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { toBlob, toJpeg } from "html-to-image";
import { zipSync } from "fflate";
import { SlideSurface } from "../SlideSurface";
import { download } from "../api";
import type { Project } from "../types";

async function renderPage(project: Project, index: number, host: HTMLElement) {
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <SlideSurface
        slide={project.document.slides[index]}
        size={project.document}
      />,
    ),
  );
  try {
    await document.fonts.ready;
    const deadline = Date.now() + 20000;
    while (true) {
      const statuses = [...host.querySelectorAll('[role="status"]')];
      if (statuses.some((status) => status.textContent?.includes("失败")))
        throw new Error(`第 ${index + 1} 页素材加载失败`);
      const images = [...host.querySelectorAll("img")];
      if (
        !statuses.length &&
        images.every((image) => image.complete && image.naturalWidth > 0)
      )
        break;
      if (Date.now() > deadline)
        throw new Error(`第 ${index + 1} 页素材准备超时`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await Promise.all(
      [...host.querySelectorAll("img")].map((image) => image.decode()),
    );
    return {
      node: host.querySelector<HTMLElement>(".presentation-slide")!,
      dispose: () => root.unmount(),
    };
  } catch (error) {
    root.unmount();
    throw error;
  }
}

export async function exportImages(
  project: Project,
  indices: number[],
  format: "png" | "jpeg",
) {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${project.document.width}px;height:${project.document.height}px;pointer-events:none`;
  document.body.append(host);
  const files: Record<string, Uint8Array> = {};
  try {
    for (const index of indices) {
      const page = await renderPage(project, index, host);
      try {
        const options = {
          pixelRatio: 1,
          width: project.document.width,
          height: project.document.height,
          cacheBust: false,
        };
        const blob =
          format === "png"
            ? await toBlob(page.node, options)
            : await (
                await fetch(
                  await toJpeg(page.node, { ...options, quality: 0.95 }),
                )
              ).blob();
        if (!blob) throw new Error("页面图片转换失败");
        files[`slide-${String(index + 1).padStart(3, "0")}.${format}`] =
          new Uint8Array(await blob.arrayBuffer());
      } finally {
        page.dispose();
      }
    }
    if (indices.length === 1)
      download(
        new Blob([Object.values(files)[0].slice().buffer], {
          type: `image/${format}`,
        }),
        `${project.title}-${indices[0] + 1}.${format}`,
      );
    else
      download(
        new Blob([zipSync(files).slice().buffer], { type: "application/zip" }),
        `${project.title}-${format}.zip`,
      );
  } finally {
    host.remove();
  }
}

export async function printDocument(project: Project, indices: number[]) {
  const host = document.createElement("div");
  host.className = "presentation-print-root";
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none";
  document.body.append(host);
  const disposers: (() => void)[] = [];
  const style = document.createElement("style");
  style.textContent = `@media print { @page {size:${project.document.width}px ${project.document.height}px;margin:0} body > *{display:none!important} body > .presentation-print-root {display:block!important;position:static!important;pointer-events:auto!important} .presentation-print-root > div {break-after:page;page-break-after:always} .presentation-print-root > div:last-child{break-after:auto} .presentation-print-root *{-webkit-print-color-adjust:exact;print-color-adjust:exact} }`;
  const cleanup = () => {
    disposers.forEach((dispose) => dispose());
    host.remove();
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  try {
    for (const index of indices) {
      const frame = document.createElement("div");
      host.append(frame);
      const page = await renderPage(project, index, frame);
      disposers.push(page.dispose);
    }
    document.head.append(style);
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
