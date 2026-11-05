/** Persisted starter layouts; previews and new pages consume the same objects. */
import { programAsset } from "@platform/programAsset";
import { newElement, newSlide } from "../templates";
import type { Deck, Slide, SlideElement } from "../types";
import { defaultDefinition, type Definition, type PageType } from "./model";
import {
  defaultPage,
  editableDefinition,
  emptyScene,
  type Scene,
} from "./nativeScenes";
export const studioAssets: Record<string, string> = {
  "studio-background": programAsset(
    "presentation-templates/report-background.png",
  ),
  "studio-structured": programAsset(
    "presentation-templates/structured-template.png",
  ),
  "studio-html": programAsset("presentation-templates/html-template.png"),
  "studio-visual": programAsset("presentation-templates/visual-generation.png"),
};
export function text(
  id: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  size: number,
  bold = false,
  color = "#142B45",
  align: "left" | "center" | "right" = "left",
): SlideElement {
  return newElement("text", {
    id,
    name: value.split("\n")[0].slice(0, 40),
    x,
    y,
    width,
    height,
    fill_opacity: 0,
    text_layout: {
      padding: 0,
      align: "top",
      auto_fit: false,
      letter_spacing: 0,
      vertical: false,
    },
    paragraphs: [
      {
        runs: [
          {
            text: value,
            font: "Microsoft YaHei",
            size,
            color,
            bold,
            italic: false,
            underline: false,
          },
        ],
        align,
        line_height: 1.3,
        bullet: false,
        numbered: false,
      },
    ],
  });
}
function shape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
) {
  return newElement("rect", {
    id,
    name: "装饰",
    x,
    y,
    width,
    height,
    fill,
    stroke_width: 0,
  });
}
export function studioDefinition(): Definition {
  const original = defaultDefinition();
  for (const [type, l] of Object.entries(original.layouts)) {
    l.chapter = {
      ...l.chapter,
      x: 56,
      y: 28,
      width: 260,
      height: 32,
      style: { ...l.chapter.style, size: 20, bold: true, color: "#2677D8" },
    };
    l.title = {
      ...l.title,
      x: 56,
      y: 76,
      width: 1168,
      height: 68,
      style: { ...l.title.style, size: 44 },
    };
    l.body_top = 176;
    if (["cover", "section", "ending"].includes(type)) {
      l.chapter.y = 196;
      l.title.y = 256;
      l.title.height = 148;
      l.title.width = 1050;
      l.title.style.size = 58;
      l.body_top = 430;
    }
    if (type === "toc") {
      l.title.y = 76;
      l.toc.y = 200;
      l.toc.height = 410;
      l.toc.style.size = 30;
    }
  }
  const d = editableDefinition(original);
  d.global_scene = {
    ...emptyScene(),
    elements: [shape("corner", 1208, 0, 72, 7, "#EC805B")],
  };
  for (const [type, l] of Object.entries(d.layouts)) {
    const scene = l.scene!;
    scene.elements!.unshift(
      shape("chapter-plate", 54, l.chapter.y - 3, 168, 36, "#EAF2FE"),
      shape("chapter-mark", 44, l.chapter.y + 3, 4, 24, "#2677D8"),
    );
    scene.elements!.push(
      shape(
        "header-rule",
        56,
        ["content", "toc"].includes(type) ? 157 : 414,
        1168,
        1,
        "#D7DDE3",
      ),
    );
    scene.groups = [
      {
        id: "chapter-badge",
        name: "章节签",
        parent_id: null,
        element_ids: ["chapter-plate", "chapter-mark", "slot-chapter"],
      },
    ];
    const toc = scene.elements!.find((e) => e.id === "slot-toc")!;
    toc.hidden = type !== "toc";
    scene.elements!.find((e) => e.id === "slot-number")!.hidden =
      type === "cover";
    const defaults: Scene = emptyScene();
    if (type === "content") {
      const rows = [
        {
          title: "结构化模板",
          art: "studio-structured",
          flow: ["模板理解\n页面选择", "结构记录\nJSON 填充", "原生对象\n重建"],
          output: "原生文字、图表与形状",
          trade: "编辑粒度细；依赖模板规范",
        },
        {
          title: "HTML 模板",
          art: "studio-html",
          flow: [
            "视觉转码\n模板匹配",
            "内容填充\n渲染检查",
            "页面代码\n渲染结果",
          ],
          output: "页面代码与渲染结果",
          trade: "布局灵活；需管理字体与溢出",
        },
        {
          title: "整页视觉生成",
          art: "studio-visual",
          flow: [
            "逐页策划\n统一风格",
            "视觉生成\n分层重建",
            "视觉稿\n可改对象",
          ],
          output: "完整视觉稿与可编辑对象",
          trade: "视觉自由；需验收重建误差",
        },
      ];
      defaults.elements = rows.flatMap((r, i) => {
        const x = 56 + i * 398;
        return [
          shape(`card-${i}`, x, 188, 374, 444, "#F1F4F7"),
          text(
            `label-${i}`,
            `0${i + 1}  ${r.title}`,
            x + 18,
            208,
            338,
            40,
            28,
            true,
          ),
          newElement("image", {
            id: `art-${i}`,
            name: r.title + "插画",
            asset_id: r.art,
            x: x + 106,
            y: 254,
            width: 152,
            height: 140,
          }),
          ...r.flow.flatMap((value, j) => [
            shape(`node-${i}-${j}`, x + 18 + j * 119, 404, 100, 74, "#FFFFFF"),
            text(
              `flow-${i}-${j}`,
              value,
              x + 18 + j * 119,
              413,
              100,
              58,
              20,
              false,
              "#142B45",
              "center",
            ),
          ]),
          text(
            `output-${i}`,
            "交付  " + r.output,
            x + 18,
            492,
            338,
            62,
            22,
            true,
          ),
          text(
            `trade-${i}`,
            r.trade,
            x + 18,
            570,
            338,
            52,
            20,
            false,
            "#617386",
          ),
        ];
      });
      defaults.groups = rows.map((r, i) => ({
        id: `column-${i}`,
        name: r.title,
        parent_id: null,
        element_ids: [
          `card-${i}`,
          `label-${i}`,
          `art-${i}`,
          ...r.flow.flatMap((_, j) => [`node-${i}-${j}`, `flow-${i}-${j}`]),
          `output-${i}`,
          `trade-${i}`,
        ],
      }));
      defaults.connections = rows.flatMap((_, i) =>
        [0, 1].map((j) => ({
          id: `flow-arrow-${i}-${j}`,
          source_id: `node-${i}-${j}`,
          target_id: `node-${i}-${j + 1}`,
          source_anchor: "right" as const,
          target_anchor: "left" as const,
          source_offset: 0.5,
          target_offset: 0.5,
          style: "straight" as const,
          label: "",
          color: "#2677D8",
          width: 1.5,
          arrow: true,
          layer: defaults.elements!.length,
          waypoints: [],
        })),
      );
    } else if (type === "cover")
      defaults.elements = [
        text(
          "subtitle",
          "三个项目 · 从资料理解到可控交付",
          56,
          450,
          1080,
          60,
          28,
          false,
          "#617386",
        ),
      ];
    else if (type === "section")
      defaults.elements = [
        text(
          "overview",
          "核心问题  /  方案取舍  /  实现与验证",
          56,
          450,
          1080,
          60,
          28,
          false,
          "#617386",
        ),
      ];
    else if (type === "ending")
      defaults.elements = [
        text(
          "next",
          "交付成果 · 验证证据 · 下一步",
          56,
          450,
          1080,
          60,
          28,
          false,
          "#617386",
        ),
      ];
    l.defaults = defaults;
  }
  return d;
}
const titles: Record<PageType, string> = {
  cover: "AI 应用实践",
  toc: "项目目录",
  section: "从技术选择到可控交付",
  content: "三条生成链路的技术选择",
  ending: "主要交付与下一步",
};
export function studioPreview(
  definition: Definition,
  type: PageType = "content",
): Deck {
  const binding = {
    name: "技术汇报",
    template_revision: 0,
    snapshot: definition,
  };
  const slide =
    definition.version === 2
      ? defaultPage(definition, type, binding)
      : newSlide();
  slide.id = "studio-preview";
  slide.page_type = type;
  slide.title = titles[type];
  slide.chapter_id = type === "content" ? "ppt-agent" : null;
  const slides: Slide[] = Array.from({ length: 9 }, (_, i) => ({
    ...newSlide(),
    id: `studio-context-${i}`,
    chapter_id:
      i < 4 ? ["background", "solution", "scenario", "future"][i] : null,
  }));
  slides[8] = slide;
  return {
    version: definition.version === 2 ? 5 : 4,
    width: definition.width,
    height: definition.height,
    template: binding,
    chapters: [
      { id: "ppt-agent", title: "PPT Agent" },
      { id: "background", title: "项目背景" },
      { id: "solution", title: "技术方案" },
      { id: "scenario", title: "应用场景" },
      { id: "future", title: "未来规划" },
    ],
    slides,
  };
}
export const previewPage = (deck: Deck) => deck.slides.at(-1)!;
export function starterDocument(definition: Definition): Deck {
  const content = studioPreview(definition);
  const slides = (
    ["cover", "toc", "section", "content", "ending"] as const
  ).map((type) => ({
    ...previewPage(studioPreview(definition, type)),
    id: crypto.randomUUID(),
  }));
  slides[0].chapter_id = "background";
  slides[2].chapter_id = "solution";
  slides[3].chapter_id = "ppt-agent";
  return { ...content, slides };
}
