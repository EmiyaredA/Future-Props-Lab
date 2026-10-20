import { describe, expect, it } from "vitest";
import {
  copySlide,
  defaultRun,
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";
import {
  duplicatePages,
  movePages,
  removePages,
} from "../src/features/presentation-workshop/editor/pageOperations";
import {
  replaceInDeck,
  replaceRuns,
  searchDeck,
} from "../src/features/presentation-workshop/editor/searchText";
import {
  animationFrames,
  animationGroups,
} from "../src/features/presentation-workshop/playback/animationModel";

describe("v3 文稿编辑语义", () => {
  it("跨样式查找替换保留首字符格式，替换文本按字面处理", () => {
    const runs = [defaultRun("Hello "), { ...defaultRun("World"), bold: true }];
    const replaced = replaceRuns(runs, "lo Wo", "$&");
    expect(replaced.map((r) => r.text).join("")).toBe("Hel$&rld");
    expect(replaced[0].bold).toBe(false);
    expect(replaced.at(-1)?.bold).toBe(true);
    expect(runs.map((r) => r.text).join("")).toBe("Hello World");
    expect(replaceRuns(runs, ".*", "x")).toBe(runs);
  });
  it("替换包括富文本备注，跳过锁定对象", () => {
    const deck = newDeck("blank"),
      page = deck.slides[0];
    page.notes = "测试";
    page.notes_rich = [
      {
        align: "left",
        line_height: 1.3,
        bullet: false,
        numbered: false,
        runs: [defaultRun("测试")],
      },
    ];
    page.elements = [
      newElement("text", { locked: true, paragraphs: page.notes_rich }),
      newElement("text", { paragraphs: page.notes_rich }),
    ];
    expect(searchDeck(deck, "测试")).toHaveLength(3);
    const result = replaceInDeck(deck, "测试", "完成");
    expect(result.slides[0].notes).toBe("完成");
    expect(result.slides[0].notes_rich?.[0].runs[0].text).toBe("完成");
    expect(result.slides[0].elements[0]).toBe(page.elements[0]);
    expect(result.slides[0].elements[1].paragraphs[0].runs[0].text).toBe(
      "完成",
    );
  });
  it("整页复制重映射动画、批注、回复及页内超链接身份", () => {
    const page = newDeck("blank").slides[0],
      element = newElement("rect");
    page.elements = [element];
    element.link = { type: "slide", target: page.id };
    page.animations = [
      {
        id: "animation",
        element_id: element.id,
        effect: "fade",
        type: "in",
        trigger: "click",
        duration: 300,
        delay: 0,
        direction: "left",
      },
    ];
    page.annotations = [
      {
        id: "comment",
        element_id: element.id,
        text: "检查",
        resolved: false,
        replies: [{ id: "reply", text: "收到" }],
      },
    ];
    const copy = copySlide(page);
    expect(copy.id).not.toBe(page.id);
    expect(copy.animations?.[0].element_id).toBe(copy.elements[0].id);
    expect(copy.animations?.[0].id).not.toBe("animation");
    expect(copy.annotations?.[0].element_id).toBe(copy.elements[0].id);
    expect(copy.annotations?.[0].replies?.[0].id).not.toBe("reply");
    expect(copy.elements[0].link?.target).toBe(copy.id);
  });
  it("多页移动保留相对顺序，删除清理页面链接且禁止删空", () => {
    const deck = newDeck("blank"),
      a = deck.slides[0],
      b = copySlide(a),
      c = copySlide(a);
    deck.slides = [a, b, c];
    a.elements = [
      newElement("rect", { link: { type: "slide", target: b.id } }),
    ];
    expect(movePages(deck, [a.id, b.id], 3).slides.map((s) => s.id)).toEqual([
      c.id,
      a.id,
      b.id,
    ]);
    expect(removePages(deck, [b.id]).slides[0].elements[0].link).toBe(null);
    expect(() =>
      removePages(
        deck,
        deck.slides.map((s) => s.id),
      ),
    ).toThrow();
    expect(duplicatePages(deck, [a.id, b.id]).slides).toHaveLength(5);
  });
  it("隐藏对象不占点击步骤，同时与之后触发共享点击边界", () => {
    const page = newDeck("blank").slides[0],
      a = newElement("rect"),
      b = newElement("rect", { hidden: true });
    page.elements = [a, b];
    const base = {
      effect: "fade" as const,
      type: "in" as const,
      trigger: "click" as const,
      duration: 300,
      delay: 0,
      direction: "left" as const,
    };
    page.animations = [
      { ...base, id: "hidden", element_id: b.id },
      { ...base, id: "a", element_id: a.id },
      { ...base, id: "b", element_id: a.id, trigger: "with_previous" },
      { ...base, id: "c", element_id: a.id, trigger: "after_previous" },
      { ...base, id: "d", element_id: a.id },
    ];
    expect(
      animationGroups(page).map((group) => group.map((a) => a.id)),
    ).toEqual([["a", "b", "c"], ["d"]]);
    const enter = animationFrames(page.animations[1]);
    expect(animationFrames({ ...page.animations[1], type: "out" })).toEqual(
      [...enter].reverse(),
    );
  });
});
