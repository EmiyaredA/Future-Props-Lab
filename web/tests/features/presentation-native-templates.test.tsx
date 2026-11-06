import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  studioDefinition,
  studioPreview,
  previewPage,
} from "@features/presentation-workshop/master/studioPreview";
import {
  resolveSlide,
  defaultDefinition,
} from "@features/presentation-workshop/master/model";
import {
  defaultPage,
  editableDefinition,
} from "@features/presentation-workshop/master/nativeScenes";
import {
  canvasScene,
  commitCanvas,
} from "@features/presentation-workshop/master/canvas/canvasModel";
import { useTemplateHistory } from "@features/presentation-workshop/master/canvas/useTemplateHistory";
import { copySlide } from "@features/presentation-workshop/templates";
import {
  cleanScene,
  groupSelection,
} from "@features/presentation-workshop/scene/model";

describe("native template canvas", () => {
  it("legacy upgrade has no invented body, five real layouts share preview/default data", () => {
    const legacy = editableDefinition(defaultDefinition());
    expect(legacy.version).toBe(2);
    expect(
      Object.values(legacy.layouts).every((l) => !l.defaults?.elements?.length),
    ).toBe(true);
    const d = studioDefinition();
    for (const type of [
      "cover",
      "toc",
      "section",
      "content",
      "ending",
    ] as const) {
      const page = defaultPage(d, type);
      expect(page.elements).toHaveLength(
        d.layouts[type].defaults!.elements!.length,
      );
      if (page.elements.length)
        expect(page.elements.map((e) => e.id)).not.toEqual(
          d.layouts[type].defaults!.elements!.map((e) => e.id),
        );
      expect(
        page.groups
          ?.flatMap((g) => g.element_ids ?? [])
          .every((id) => page.elements.some((e) => e.id === id)),
      ).toBe(true);
    }
  });
  it("canvas edits persist geometry and group scope while semantic data stays dynamic", () => {
    const d = studioDefinition(),
      slide = canvasScene(d, "content"),
      before = JSON.stringify(d);
    const title = slide.elements.find((e) => e.id === "page:slot-title")!;
    title.x += 30;
    title.rotation = 12;
    title.paragraphs[0].runs[0].text = "不能替换真实标题";
    const updated = commitCanvas(d, "content", slide);
    expect(JSON.stringify(d)).toBe(before);
    const stored = updated.layouts.content.scene!.elements!.find(
      (e) => e.id === "slot-title",
    )!;
    expect(stored.x).toBe(86);
    expect(stored.rotation).toBe(12);
    expect(stored.paragraphs[0].runs[0].text).not.toBe("不能替换真实标题");
    const deck = studioPreview(updated),
      rendered = resolveSlide(deck, previewPage(deck));
    expect(
      rendered.elements.some((e) =>
        e.paragraphs.some((p) =>
          p.runs.some((r) => r.text === "三条生成链路的技术选择"),
        ),
      ),
    ).toBe(true);
    const global = canvasScene(updated, "ending").elements.find(
      (e) => e.id === "global:corner",
    )!;
    global.x = 100;
    const changed = commitCanvas(updated, "ending", {
      ...canvasScene(updated, "ending"),
      elements: canvasScene(updated, "ending").elements.map((e) =>
        e.id === global.id ? global : e,
      ),
    });
    expect(
      canvasScene(changed, "content").elements.find(
        (e) => e.id === "global:corner",
      )!.x,
    ).toBe(100);
  });
  it("copy and remove preserve explicit layout links without dangling references", () => {
    const page = defaultPage(studioDefinition(), "content");
    const copied = copySlide(page);
    expect(
      copied.layout_source!.objects!.every((o) =>
        copied.elements.some((e) => e.id === o.element_id),
      ),
    ).toBe(true);
    const cleaned = cleanScene({
      ...copied,
      elements: copied.elements.slice(1),
    });
    expect(cleaned.layout_source!.objects).toHaveLength(
      copied.elements.length - 1,
    );
  });
  it("completed gestures are single undo steps, redo is invalidated by later edits", () => {
    const d = studioDefinition();
    const { result } = renderHook(() => useTemplateHistory(d));
    const slide = canvasScene(d, "content");
    const moved = {
      ...slide,
      elements: slide.elements.map((e) => ({ ...e, x: e.x + 10 })),
    };
    act(() => result.current.commit(commitCanvas(d, "content", moved)));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.value).toEqual(d);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.value).not.toEqual(d);
    act(() => result.current.undo());
    act(() => result.current.commit({ ...d, accent: "#FF0000" }));
    expect(result.current.canRedo).toBe(false);
  });
  it("grouped default content is persisted as native members", () => {
    const d = studioDefinition(),
      s = canvasScene(d, "content");
    const ids = ["page:slot-title", "page:slot-number"];
    const grouped = groupSelection(s, ids, "page:pair", null);
    const saved = commitCanvas(d, "content", grouped);
    expect(
      saved.layouts.content.scene!.groups!.find((g) => g.id === "pair")
        ?.element_ids,
    ).toEqual(["slot-title", "slot-number"]);
  });
  it("rejects groups and connections crossing global, page and default scopes", () => {
    const definition = studioDefinition();
    const slide = canvasScene(definition, "content");
    const grouped = groupSelection(
      slide,
      ["global:corner", "page:slot-title"],
      "page:mixed",
      null,
    );
    expect(() => commitCanvas(definition, "content", grouped)).toThrow(
      "不能跨影响范围",
    );
    const connection = slide.connections![0];
    expect(() =>
      commitCanvas(definition, "content", {
        ...slide,
        connections: [{ ...connection, source_id: "global:corner" }],
      }),
    ).toThrow("不能跨影响范围");
  });
});

import nativeCase from "../../../tests/fixtures/presentation_native_template_cases.json";
import type { Deck } from "@features/presentation-workshop/types";
it("native resolver matches backend fixtures including rotated text and groups", () => {
  const deck = nativeCase.document as unknown as Deck;
  const actual = deck.slides.map((s) => {
    const resolved = resolveSlide(deck, s);
    return {
      elements: resolved.elements.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        rotation: e.rotation,
        hidden: e.hidden ?? false,
        locked: e.locked,
        text: e.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(""),
      })),
      groups: resolved.groups,
    };
  });
  expect(actual).toEqual(nativeCase.resolved);
});

import { themeChange } from "@features/presentation-workshop/master/canvas/themeChange";
it("global theme changes persist across all native prototypes without losing local accents", () => {
  const before = studioDefinition(),
    changed = themeChange(before, { font: "Arial", foreground: "#111111" });
  for (const layout of Object.values(changed.layouts))
    for (const scene of [layout.scene, layout.defaults])
      for (const e of scene?.elements ?? [])
        for (const p of e.paragraphs)
          for (const run of p.runs) expect(run.font).toBe("Arial");
  expect(
    changed.layouts.content.scene!.elements!.find((e) => e.id === "slot-title")!
      .paragraphs[0].runs[0].color,
  ).toBe("#111111");
  expect(
    changed.layouts.content.scene!.elements!.find(
      (e) => e.id === "slot-chapter",
    )!.paragraphs[0].runs[0].color,
  ).toBe("#2677D8");
  expect(before.font).toBe("Microsoft YaHei");
});
