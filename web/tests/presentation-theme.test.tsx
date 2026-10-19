import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  newElement,
  newSlide,
  newDeck,
} from "@features/presentation-workshop/templates";
import {
  applySlideTheme,
  pageColors,
  slideTheme,
  themeMapping,
} from "@features/presentation-workshop/slideTheme";
import { SlideThemeDialog } from "@features/presentation-workshop/SlideThemeDialog";
import { PresentationToolbar } from "@features/presentation-workshop/PresentationToolbar";
import { PresentationInspector } from "@features/presentation-workshop/PresentationInspector";
import { usePresentationDraft } from "@features/presentation-workshop/usePresentationDraft";
import type { Project } from "@features/presentation-workshop/types";

vi.mock("@features/presentation-workshop/SlideSurface", () => ({
  SlidePreview: ({ slide }: { slide: { background: string } }) => (
    <output aria-label="预览背景">{slide.background}</output>
  ),
}));
vi.mock("@features/presentation-workshop/api", () => ({
  saveProject: vi.fn(),
  createProject: vi.fn(),
}));

function legacy() {
  const slide = newSlide();
  slide.background = "#FFFFFF";
  slide.elements = [
    newElement("text", {
      id: "text",
      paragraphs: [
        {
          align: "left",
          line_height: 1.4,
          bullet: true,
          numbered: false,
          runs: [
            {
              text: "警示与正文",
              font: "Microsoft YaHei",
              size: 27,
              color: "#24344B",
              bold: true,
              italic: true,
              underline: false,
            },
          ],
        },
      ],
    }),
    newElement("roundRect", {
      id: "node",
      x: 12,
      rotation: 15,
      fill: "#EFF5FA",
      stroke: "#4A7D9A",
      stroke_dash: "dash",
      corner_radius: 4,
      opacity: 0.4,
    }),
    newElement("rect", { id: "locked", locked: true, fill: "#6476DC" }),
    newElement("image", { id: "image", asset_id: "picture", fill: "#6476DC" }),
    newElement("vector", {
      id: "svg",
      asset_id: "svg",
      vector_color: "#6476DC",
    }),
    newElement("rect", { id: "warning", fill: "#E75B55" }),
  ];
  slide.groups = [
    {
      id: "group",
      parent_id: null,
      name: "保留分组",
      element_ids: ["text", "node"],
    },
  ];
  slide.connections = [
    {
      id: "edge",
      layer: 0,
      source_id: "node",
      target_id: "text",
      color: "#365F62",
      width: 2,
      label: "关系",
      style: "step",
      arrow: true,
      waypoints: [{ x: 12, y: 60 }],
      source_anchor: "right",
      target_anchor: "left",
    },
    {
      id: "locked-edge",
      layer: 0,
      source_id: "locked",
      target_id: "node",
      color: "#365F62",
      width: 2,
      label: "锁定",
      style: "straight",
      arrow: false,
      waypoints: [],
      source_anchor: "right",
      target_anchor: "left",
    },
  ];
  slide.reference = {
    asset_id: "reference",
    mode: "side",
    visible: true,
    opacity: 0.4,
  };
  slide.image_asset_id = "archive";
  slide.infographics = [
    {
      id: "info",
      group_id: "group",
      format: "scene",
      source: "original source",
      template: "",
    },
  ];
  return slide;
}

it("换肤只改允许的样式，保留几何、文字、素材与场景身份，未知警示色默认保留", () => {
  const slide = legacy(),
    original = structuredClone(slide);
  const next = applySlideTheme(slide, themeMapping(slide));
  expect(slide).toEqual(original);
  expect(next.background).toBe(slideTheme.background);
  expect(next.elements[0].paragraphs[0].runs[0]).toEqual({
    ...slide.elements[0].paragraphs[0].runs[0],
    color: slideTheme.navy,
  });
  expect(next.elements[1]).toEqual({
    ...slide.elements[1],
    fill: slideTheme.fill,
    stroke: slideTheme.blue,
    corner_radius: 12,
  });
  expect(next.elements.slice(2)).toEqual(slide.elements.slice(2));
  expect(next.connections![0]).toEqual({
    ...slide.connections![0],
    color: slideTheme.teal,
  });
  expect(next.connections![1]).toEqual(slide.connections![1]);
  expect([
    next.groups,
    next.reference,
    next.image_asset_id,
    next.infographics,
  ]).toEqual([
    slide.groups,
    slide.reference,
    slide.image_asset_id,
    slide.infographics,
  ]);
  expect(pageColors(slide)).toContain("#E75B55");
  expect(
    applySlideTheme(slide, { ...themeMapping(slide), "#E75B55": "#112233" })
      .elements[5].fill,
  ).toBe("#112233");
  expect(applySlideTheme(next, themeMapping(next))).toEqual(next);
});

it("预览和自定义颜色不写入草稿，取消与 Escape 仅关闭弹窗", async () => {
  const apply = vi.fn(),
    close = vi.fn(),
    slide = legacy();
  render(<SlideThemeDialog slide={slide} onApply={apply} onClose={close} />);
  expect(screen.getByLabelText("预览背景")).toHaveTextContent(
    slideTheme.background,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "替换颜色 #E75B55" }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "替换颜色 #E75B55十六进制值" }),
    { target: { value: "#112233" } },
  );
  expect(apply).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(close).toHaveBeenCalledOnce();
  expect(slide.elements[5].fill).toBe("#E75B55");
});

it("应用作为一次草稿操作，可完整撤销和重做", async () => {
  const slide = legacy();
  const project = {
    id: "p",
    title: "旧稿",
    revision: 1,
    created_at: "",
    updated_at: "",
    document: { ...newDeck(), slides: [slide] },
  } as Project;
  function Harness() {
    const draft = usePresentationDraft(project, vi.fn());
    const [open, setOpen] = useState(true);
    return (
      <>
        <output aria-label="草稿背景">
          {draft.draft.document.slides[0].background}
        </output>
        <button onClick={draft.undo} disabled={!draft.canUndo}>
          撤销换肤
        </button>
        <button onClick={draft.redo} disabled={!draft.canRedo}>
          重做换肤
        </button>
        {open && (
          <SlideThemeDialog
            slide={slide}
            onClose={() => setOpen(false)}
            onApply={(next) =>
              draft.commit((d) => ({
                ...d,
                document: { ...d.document, slides: [next] },
              }))
            }
          />
        )}
      </>
    );
  }
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "应用到当前页" }));
  expect(screen.getByLabelText("草稿背景")).toHaveTextContent(
    slideTheme.background,
  );
  await userEvent.click(screen.getByRole("button", { name: "撤销换肤" }));
  expect(screen.getByLabelText("草稿背景")).toHaveTextContent("#FFFFFF");
  expect(screen.getByRole("button", { name: "撤销换肤" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "重做换肤" }));
  expect(screen.getByLabelText("草稿背景")).toHaveTextContent(
    slideTheme.background,
  );
});

const toolbarProps = {
  readOnly: false,
  canAdd: true,
  canUndo: false,
  canRedo: false,
  busy: false,
  hasSelection: false,
  onAdd: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onText: vi.fn(),
  onShape: vi.fn(),
  onUpload: vi.fn(),
  onLibrary: vi.fn(),
  onCopy: vi.fn(),
  onDelete: vi.fn(),
};
it("更多菜单跳过禁用项、支持键盘与关闭后焦点恢复；只读隐藏编辑命令", async () => {
  const action = vi.fn();
  const { rerender } = render(
    <PresentationToolbar
      {...toolbarProps}
      sceneActions={[
        { label: "连接节点", disabled: true, onSelect: vi.fn() },
        { label: "参考图", onSelect: action },
      ]}
    />,
  );
  const trigger = screen.getByRole("button", { name: "更多编辑工具" });
  trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "参考图" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(action).toHaveBeenCalledOnce();
  expect(trigger).toHaveFocus();
  rerender(<PresentationToolbar {...toolbarProps} readOnly />);
  expect(screen.queryByRole("toolbar")).toBeNull();
});

it.each([
  { readOnly: true, styleDisabled: false },
  { readOnly: false, styleDisabled: true },
])("只读或裁剪禁止应用风格：%j", (permissions) => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  render(
    <PresentationInspector
      slide={legacy()}
      selected={[]}
      patch={vi.fn()}
      background={vi.fn()}
      editor={null}
      arrange={vi.fn()}
      order={vi.fn()}
      editText={vi.fn()}
      onStyle={vi.fn()}
      {...permissions}
    />,
  );
  expect(screen.getByRole("button", { name: "应用蓝青风格" })).toBeDisabled();
  vi.unstubAllGlobals();
});
