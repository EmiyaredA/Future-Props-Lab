import { slideTheme } from "../slideTheme";
import { validateFragment } from "./validation";
import { newId } from "../templates";
import { uploadImage, previewSvg } from "../api";
import type { Fragment } from "../scene/model";
import { infographicTemplates } from "./catalog";
import { semanticDiagram, type DiagramData } from "./semantic";
import { convertSvg, type Conversion } from "./svgConversion";

function rejectResources(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["icon", "illus"].includes(key) && child)
      throw new Error(
        "此模板暂不转换外部图标或插画，请移除资源字段后单独插入托管素材",
      );
    rejectResources(child);
  }
}

function verifyText(value: unknown, fragment: Fragment): void {
  if (!value || typeof value !== "object") return;
  const texts = fragment.elements.flatMap((e) =>
    e.paragraphs.flatMap((p) => p.runs.map((r) => r.text.trim())),
  );
  for (const [key, child] of Object.entries(value)) {
    if (
      ["title", "desc", "label"].includes(key) &&
      typeof child === "string" &&
      child.trim() &&
      !texts.includes(child.trim()) &&
      !(fragment.connections ?? []).some((c) => c.label === child)
    )
      throw new Error(
        `关键文字「${child.slice(0, 30)}」无法完整转换，请调整模板数据`,
      );
    if (child && typeof child === "object") verifyText(child, fragment);
  }
}

export async function compileInfographic(
  source: string,
  format: "antv" | "scene",
  host: HTMLElement,
): Promise<Conversion> {
  if (source.length > 50000) throw new Error("信息图源码最多 50000 字符");
  host.replaceChildren();
  if (format === "scene") {
    const parsed = JSON.parse(source) as Fragment;
    validateFragment(parsed);
    const rootId = parsed.groups!.find((g) => !g.parent_id)!.id;
    parsed.infographics = [
      ...(parsed.infographics ?? []).filter((i) => i.group_id !== rootId),
      { id: newId(), group_id: rootId, format, template: "", source },
    ];
    return {
      fragment: structuredClone(parsed),
      decorations: [],
      notices: ["场景 JSON 将作为原生对象插入，保存时再次执行完整契约校验"],
    };
  }
  const { Infographic, parseSyntax } = await import("@antv/infographic");
  const parsed = parseSyntax(source);
  if (parsed.errors.length || parsed.warnings.length)
    throw new Error(
      [...parsed.errors, ...parsed.warnings]
        .map((e) => `第 ${e.line} 行：${e.message}`)
        .join("\n"),
    );
  const template = parsed.options.template ?? "";
  if (!infographicTemplates.some((t) => t.value === template))
    throw new Error("此模板尚未通过原生转换验证，请选择五个受支持模板");
  if (
    parsed.options.design ||
    parsed.options.theme ||
    parsed.options.themeConfig
  )
    throw new Error("首轮仅支持模板与 data，转换后可在工坊调整样式");
  rejectResources(parsed.options.data);
  let result: Conversion;
  if (template.startsWith("relation") || template === "hierarchy-structure") {
    result = {
      fragment: await semanticDiagram(
        template,
        parsed.options.data as DiagramData,
      ),
      decorations: [],
      notices: ["节点与关系已转换为原生对象，并由 ELK 排列"],
    };
  } else {
    await document.fonts.ready;
    const engine = new Infographic({
      container: host,
      editable: false,
      themeConfig: {
        colorBg: slideTheme.background,
        colorPrimary: slideTheme.blue,
        palette: [slideTheme.blue, slideTheme.teal, slideTheme.navy],
        base: { text: { "font-family": "Microsoft YaHei" } },
        desc: { fill: slideTheme.muted },
        item: {
          label: { fill: slideTheme.navy },
          desc: { fill: slideTheme.muted },
        },
      },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("信息图渲染超时")),
          10000,
        );
        engine.on("rendered", () => {
          clearTimeout(timer);
          resolve();
        });
        engine.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        // AntV applies theme text sizes after calculating layout. Keep headings
        // native so their geometry and typography share one deterministic frame.
        engine.render({
          ...parsed.options,
          data: { ...parsed.options.data, title: undefined, desc: undefined },
        });
      });
      const svg = host.querySelector("svg");
      if (!svg) throw new Error("信息图渲染未产生画面");
      result = convertSvg(svg, template, parsed.options.data);
    } finally {
      engine.destroy();
    }
  }
  const root = result.fragment.groups?.find((g) => !g.parent_id);
  verifyText(parsed.options.data, result.fragment);
  if (!root) throw new Error("转换结果缺少根分组");
  result.fragment.infographics = [
    { id: newId(), group_id: root.id, format, template, source },
  ];
  for (const decoration of result.decorations) {
    decoration.svg = (await previewSvg(decoration.svg)).svg;
  }
  return result;
}

export async function materialize(result: Conversion): Promise<Fragment> {
  const fragment = structuredClone(result.fragment);
  for (const decoration of result.decorations) {
    const uploaded = await uploadImage(
      new File([decoration.svg], "信息图装饰.svg", { type: "image/svg+xml" }),
    );
    const element = fragment.elements.find(
      (e) => e.id === decoration.elementId,
    )!;
    element.asset_id = uploaded.id;
  }
  return fragment;
}
