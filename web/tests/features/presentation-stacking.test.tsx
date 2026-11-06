import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { newDeck, newElement } from "@features/presentation-workshop/templates";
import {
  sceneOrder,
  orderScene,
} from "@features/presentation-workshop/scene/stacking";
import {
  appendFragment,
  cloneFragment,
  updateScene,
} from "@features/presentation-workshop/scene/model";
import { SlideSurface } from "@features/presentation-workshop/SlideSurface";
import { newConnection } from "@features/presentation-workshop/scene/connectionEditing";

function fixture() {
  const slide = newDeck("blank").slides[0];
  slide.elements = ["a", "b", "c"].map((id) => newElement("rect", { id }));
  slide.connections = [
    {
      ...newConnection(slide, ["a", "b"]),
      id: "ab",
      waypoints: [{ x: 30, y: 50 }],
    },
    { ...newConnection(slide, ["b", "c"]), id: "bc" },
  ];
  return slide;
}
const ids = (slide: ReturnType<typeof fixture>) =>
  sceneOrder(slide).map((i) => i.id);

describe("元素和连接统一叠放", () => {
  it("旧文稿在底层；逐层移动能越过连接和元素，边界操作不提交", () => {
    const original = fixture();
    original.connections!.forEach((edge) =>
      Reflect.deleteProperty(edge, "layer"),
    );
    expect(ids(original)).toEqual(["ab", "bc", "a", "b", "c"]);
    expect(orderScene(original, ["ab"], "backward")).toBe(original);
    const aboveEdge = orderScene(original, ["ab"], "forward");
    expect(ids(aboveEdge)).toEqual(["bc", "ab", "a", "b", "c"]);
    const aboveNode = orderScene(aboveEdge, ["ab"], "forward");
    expect(ids(aboveNode)).toEqual(["bc", "a", "ab", "b", "c"]);
    expect(aboveNode.connections?.find((c) => c.id === "ab")?.waypoints).toBe(
      original.connections![0].waypoints,
    );
    expect(ids(orderScene(aboveNode, ["ab"], "backward"))).toEqual(
      ids(aboveEdge),
    );
    const front = orderScene(aboveNode, ["ab"], "front");
    expect(ids(front)).toEqual(["bc", "a", "b", "c", "ab"]);
    expect(orderScene(front, ["ab"], "forward")).toBe(front);
    expect(ids(orderScene(front, ["ab"], "back"))).toEqual(ids(original));
  });

  it("元素层级操作也能越过连接，渲染使用同一前后顺序", () => {
    const slide = orderScene(fixture(), ["b"], "back");
    expect(ids(slide)).toEqual(["b", "ab", "bc", "a", "c"]);
    const view = render(<SlideSurface slide={slide} />);
    const painted = [
      ...view.container.querySelector(".presentation-slide")!.children,
    ].map(
      (node) =>
        node.getAttribute("data-element-id") ??
        node
          .querySelector("[data-connection-id]")
          ?.getAttribute("data-connection-id"),
    );
    expect(painted).toEqual(ids(slide));
  });

  it("复制片段重算局部层级，粘贴与删除不漂移原连接的相对顺序", () => {
    const slide = orderScene(fixture(), ["ab"], "front");
    let n = 0;
    const fragment = cloneFragment(slide, ["a", "b"], () => `copy-${n++}`, 0);
    const appended = appendFragment(slide, fragment);
    expect(ids(appended).slice(0, 5)).toEqual(ids(slide));
    expect(appended.connections!.at(-1)?.layer).toBe(5);
    const removed = updateScene(slide, {
      ...slide,
      elements: slide.elements.filter((e) => e.id !== "c"),
    });
    expect(ids(removed)).toEqual(["a", "b", "ab"]);
  });
});
