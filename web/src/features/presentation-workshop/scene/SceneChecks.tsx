import { useState } from "react";
import { defaultPageSize, type PageSize, type Slide } from "../types";
import { rotatedBounds } from "../selectionGeometry";

type Issue = { id: string; message: string };
function inspectScene(
  slide: Slide,
  size: PageSize = defaultPageSize,
  root: ParentNode = document,
): Issue[] {
  const issues: Issue[] = [];
  for (const element of slide.elements) {
    if (element.hidden) continue;
    const box = rotatedBounds([element]);
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > size.width ||
      box.y + box.height > size.height
    )
      issues.push({ id: element.id, message: "元素超出页面边界" });
    const node = [
      ...root.querySelectorAll<HTMLElement>(
        ".presentation-canvas [data-element-id]",
      ),
    ].find((n) => n.dataset.elementId === element.id);
    const text = node?.querySelector<HTMLElement>(".presentation-text");
    if (
      text &&
      (text.scrollHeight > text.clientHeight + 2 ||
        text.scrollWidth > text.clientWidth + 2)
    )
      issues.push({
        id: element.id,
        message: "文字可能溢出，请检查字号、换行和文本框尺寸",
      });
    if (
      node
        ?.querySelector(".presentation-image-status")
        ?.textContent?.includes("失败")
    )
      issues.push({ id: element.id, message: "素材加载失败" });
    for (const font of new Set(
      element.paragraphs.flatMap((p) => p.runs.map((r) => r.font)),
    )) {
      if (!fontAvailable(font))
        issues.push({
          id: element.id,
          message: `${font} 在当前设备不可用，预览使用替代字体`,
        });
    }
  }
  for (const edge of slide.connections ?? [])
    if (
      ![edge.source_id, edge.target_id].every((id) =>
        slide.elements.some((e) => e.id === id),
      )
    )
      issues.push({ id: edge.id, message: "连接的节点不存在" });
  return issues;
}

function fontAvailable(font: string) {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return true;
  const sample = "汉字排版 WwMm012345";
  return ["monospace", "serif"].some((fallback) => {
    context.font = `36px ${fallback}`;
    const baseline = context.measureText(sample).width;
    context.font = `36px "${font}", ${fallback}`;
    return Math.abs(context.measureText(sample).width - baseline) > 0.1;
  });
}

export function SceneChecks({
  slide,
  size,
  select,
  onClose,
}: {
  slide: Slide;
  size?: PageSize;
  select: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [issues, setIssues] = useState(() => inspectScene(slide, size));
  return (
    <section className="presentation-scene-checks" aria-label="页面检查">
      <header>
        <strong>页面检查</strong>
        <button
          className="btn"
          onClick={() => setIssues(inspectScene(slide, size))}
        >
          重新检查
        </button>
        <button className="btn" onClick={onClose}>
          关闭检查
        </button>
      </header>
      <p>
        检查只定位问题，不自动修改内容。{!issues.length && "当前未发现问题。"}
      </p>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.id}-${index}`}>
            <button
              className="btn"
              onClick={() => {
                select([issue.id]);
                document
                  .querySelector<HTMLElement>(".presentation-canvas")
                  ?.focus();
              }}
            >
              {issue.message}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
