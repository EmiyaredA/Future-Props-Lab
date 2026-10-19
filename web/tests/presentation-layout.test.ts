import { describe, expect, it } from "vitest";
import {
  newElement,
  newSlide,
} from "@features/presentation-workshop/templates";
import {
  applyLayout,
  layoutContext,
  layoutControls,
  layoutObjects,
} from "@features/presentation-workshop/layoutObjects";
import {
  resizeSelection,
  snapResize,
  snapTranslation,
} from "@features/presentation-workshop/layoutSnapping";
import {
  resizeHandles,
  rotatedBounds,
} from "@features/presentation-workshop/selectionGeometry";
import { updateScene } from "@features/presentation-workshop/scene/model";
import type {
  Slide,
  SlideElement,
} from "@features/presentation-workshop/types";

const rect = (id: string, x: number, y = 100, width = 100, height = 60) =>
  newElement("rect", { id, x, y, width, height });
const slide = (
  elements: SlideElement[],
  groups: Slide["groups"] = [],
): Slide => ({ ...newSlide("blank"), elements, groups });
const container = { x: -4000, y: -4000, width: 8000, height: 8000 };

describe("logical layout objects", () => {
  const grouped = () =>
    slide(
      [rect("a", 100), rect("b", 250), rect("c", 600), rect("outside", 950)],
      [
        { id: "root", name: "卡片", parent_id: null, element_ids: ["c"] },
        {
          id: "child",
          name: "按钮",
          parent_id: "root",
          element_ids: ["a", "b"],
        },
      ],
    );
  it("resolves nested groups as atomic siblings and fixes scope bounds", () => {
    const s = grouped();
    expect(layoutObjects(s, null).map((o) => o.id)).toEqual([
      "group:root",
      "element:outside",
    ]);
    expect(layoutObjects(s, "root").map((o) => o.id)).toEqual([
      "group:child",
      "element:c",
    ]);
    const context = layoutContext(s, ["a"], "child");
    expect(context.others.map((o) => o.id)).toEqual(["element:b"]);
    expect(context.container).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 60,
    });
  });
  it("aligns entire groups without collapsing member spacing", () => {
    const s = grouped(),
      ids = s.elements.map((e) => e.id);
    const output = applyLayout(s, ids, null, "right");
    expect(output.elements[1].x - output.elements[0].x).toBe(150);
    expect(rotatedBounds(output.elements.slice(0, 3)).x + 600).toBe(1050);
    expect(
      layoutControls(s, ["a", "b", "c"]).commands.find(
        (c) => c.mode === "vertical",
      )?.reason,
    ).toBeTruthy();
  });
  it("uses selection order for size reference, including removal and marquee order", () => {
    const s = slide([
      rect("a", 100, 100, 80),
      rect("b", 250, 100, 160),
      rect("c", 600, 100, 120),
    ]);
    expect(
      applyLayout(s, ["b", "a", "c"], null, "width").elements.map(
        (e) => e.width,
      ),
    ).toEqual([160, 160, 160]);
    expect(applyLayout(s, ["a", "c"], null, "width").elements[2].width).toBe(
      80,
    );
    expect(
      applyLayout(
        s,
        s.elements.map((e) => e.id),
        null,
        "width",
      ).elements.map((e) => e.width),
    ).toEqual([80, 80, 80]);
  });
  it("preserves centers, rotations, text runs, and media ratios", () => {
    const text = newElement("text", {
      id: "text",
      x: 400,
      y: 400,
      width: 100,
      height: 60,
      rotation: 30,
    });
    const image = newElement("image", {
      id: "image",
      x: 600,
      y: 200,
      width: 100,
      height: 50,
    });
    const s = slide([rect("ref", 100, 100, 200, 100), text, image]);
    const output = applyLayout(s, ["ref", "text", "image"], null, "width");
    output.elements.forEach((e, i) => {
      expect(e.x + e.width / 2).toBeCloseTo(
        s.elements[i].x + s.elements[i].width / 2,
      );
      expect(e.y + e.height / 2).toBeCloseTo(
        s.elements[i].y + s.elements[i].height / 2,
      );
      expect(e.rotation).toBe(s.elements[i].rotation);
    });
    expect(output.elements[1].paragraphs).toBe(text.paragraphs);
    expect(output.elements[2].height).toBe(100);
    expect(
      applyLayout(s, ["ref", "image"], null, "size").elements[2].width,
    ).toBe(200);
    expect(applyLayout(s, ["text", "image"], null, "size")).toBe(s);
  });
  it("rejects an entire command for locks, ratio conflicts, read-only or size limits", () => {
    const s = grouped();
    s.elements[0].locked = true;
    expect(
      applyLayout(
        s,
        s.elements.map((e) => e.id),
        null,
        "left",
      ),
    ).toBe(s);
    expect(
      layoutControls(s, ["outside"], null, true).commands.every(
        (c) => c.reason,
      ),
    ).toBe(true);
    expect(
      layoutControls(s, ["a", "b", "c", "outside"]).commands.every(
        (c) => c.reason,
      ),
    ).toBe(true);
    const large = slide([
      rect("ref", 0, 0, 10000),
      newElement("image", { id: "i", width: 1, height: 2 }),
    ]);
    expect(applyLayout(large, ["ref", "i"], null, "width")).toBe(large);
  });
  it("scales group positions with their members and updates bound connections", () => {
    const s = grouped();
    s.connections = [
      {
        id: "edge",
        layer: 0,
        source_id: "a",
        target_id: "outside",
        style: "step",
        source_anchor: "right",
        target_anchor: "left",
        arrow: true,
        color: "#000000",
        label: "",
        width: 2,
        waypoints: [{ x: 1, y: 1 }],
      },
    ];
    const output = updateScene(
      s,
      applyLayout(s, ["outside", "a", "b", "c"], null, "width"),
    );
    expect(rotatedBounds(output.elements.slice(0, 3)).width).toBeCloseTo(100);
    expect(output.elements[1].x - output.elements[0].x).toBeCloseTo(25);
    expect(output.connections![0].waypoints).toEqual([]);
  });
  it("distributes visual groups with fixed endpoints; one selected object uses its container", () => {
    const s = slide([rect("a", 100), rect("b", 250), rect("c", 700)]);
    expect(
      applyLayout(s, ["a", "b", "c"], null, "horizontal").elements.map(
        (e) => e.x,
      ),
    ).toEqual([100, 400, 700]);
    expect(applyLayout(s, ["a"], null, "center").elements[0].x).toBe(590);
    const groupedSlide = grouped();
    expect(
      applyLayout(groupedSlide, ["a"], "child", "right").elements[0].x,
    ).toBe(250);
  });
});

describe("smart move guides", () => {
  it.each([0.25, 1, 2])(
    "uses screen thresholds and sticky release at scale %s",
    (scale) => {
      const box = { x: 180, y: 200, width: 40, height: 30 };
      const target = layoutObjects(
        slide([rect("target", 100, 500, 40, 30)]),
        null,
      );
      const acquire = snapTranslation(
        box,
        0,
        0,
        target,
        { x: 0, y: 0, width: 1280, height: 720 },
        scale,
      );
      // Target's right edge at 140, moving left approaches it.
      const first = snapTranslation(
        box,
        -40 + 5 / scale,
        0,
        target,
        container,
        scale,
      );
      expect(first.dx).toBeCloseTo(-40);
      const held = snapTranslation(
        box,
        -40 + 9 / scale,
        0,
        target,
        container,
        scale,
        first.memory,
      );
      expect(held.dx).toBeCloseTo(-40);
      const released = snapTranslation(
        box,
        -40 + 11 / scale,
        0,
        target,
        container,
        scale,
        first.memory,
      );
      expect(released.memory).not.toContain(first.memory[0]);
      expect(acquire.guides).toBeDefined();
    },
  );
  it("snaps to equal gaps between and after neighbors, ignores another row", () => {
    const objects = layoutObjects(
      slide([rect("a", 100), rect("b", 500)]),
      null,
    );
    const between = snapTranslation(
      { x: 302, y: 100, width: 100, height: 60 },
      0,
      0,
      objects,
      container,
      1,
    );
    expect(between.dx).toBe(-2);
    expect(
      between.guides.filter((g) => g.kind === "gap").map((g) => g.label),
    ).toEqual(["100", "100"]);
    const after = snapTranslation(
      { x: 902, y: 100, width: 100, height: 60 },
      0,
      0,
      objects,
      container,
      1,
    );
    expect(after.dx).toBe(-2);
    const elsewhere = snapTranslation(
      { x: 302, y: 600, width: 100, height: 60 },
      0,
      0,
      objects,
      container,
      1,
    );
    expect(elsewhere.guides.some((g) => g.kind === "gap")).toBe(false);
  });
  it("uses locked siblings as references and visual bounds of rotated elements", () => {
    const target = rect("locked", 300);
    target.locked = true;
    const moving = rect("moving", 100, 100, 100, 100);
    moving.rotation = 45;
    const box = rotatedBounds([moving]);
    const result = snapTranslation(
      box,
      300 - box.x + 3,
      0,
      layoutObjects(slide([target]), null),
      container,
      1,
    );
    expect(box.x + result.dx).toBeCloseTo(300);
  });
});

describe("smart resize guides", () => {
  it.each([0.25, 1, 2])(
    "retains resize references within the screen release threshold at scale %s",
    (scale) => {
      const e = rect("moving", 300, 300, 100, 60);
      const objects = layoutObjects(
        slide([
          rect("z", 1500, 1500, 160, 500),
          rect("a", 1600, 1600, 160, 500),
        ]),
        null,
      );
      const acquire = snapResize(
        [e],
        60 + 5 / scale,
        0,
        "e",
        false,
        objects,
        container,
        scale,
      );
      expect(acquire.dx).toBeCloseTo(60);
      const held = snapResize(
        [e],
        60 + 9 / scale,
        0,
        "e",
        false,
        [...objects].reverse(),
        container,
        scale,
        acquire.memory,
      );
      expect(held.dx).toBeCloseTo(60);
      expect(held.memory).toEqual(acquire.memory);
      const released = snapResize(
        [e],
        60 + 11 / scale,
        0,
        "e",
        false,
        objects,
        container,
        scale,
        acquire.memory,
      );
      expect(released.memory).not.toContain(acquire.memory[0]);
    },
  );
  it.each(resizeHandles)(
    "%s matches local size and retains opposite anchor for rotated objects",
    (handle) => {
      const e = rect("moving", 300, 300, 100, 60);
      e.rotation = 30;
      const cos = Math.cos(Math.PI / 6),
        sin = Math.sin(Math.PI / 6);
      const horizontal = handle.includes("w") || handle.includes("e");
      const sign = handle.includes("w") || handle === "n" ? -1 : 1;
      const localX = horizontal ? sign * 22 : 0,
        localY = horizontal ? 0 : sign * 22;
      const target = rect(
        "target",
        1500,
        1500,
        horizontal ? 120 : 500,
        horizontal ? 500 : 80,
      );
      const snap = snapResize(
        [e],
        localX * cos - localY * sin,
        localX * sin + localY * cos,
        handle,
        false,
        layoutObjects(slide([target]), null),
        container,
        1,
      );
      const output = resizeSelection([e], snap.dx, snap.dy, handle, false)[0];
      expect(horizontal ? output.width : output.height).toBeCloseTo(
        horizontal ? 120 : 80,
      );
      const opposite = (item: SlideElement) => {
        const hx = handle.includes("w") ? 1 : handle.includes("e") ? -1 : 0;
        const hy = handle.includes("n") ? 1 : handle.includes("s") ? -1 : 0;
        return [
          item.x +
            item.width / 2 +
            ((hx * item.width) / 2) * cos -
            ((hy * item.height) / 2) * sin,
          item.y +
            item.height / 2 +
            ((hx * item.width) / 2) * sin +
            ((hy * item.height) / 2) * cos,
        ];
      };
      opposite(output).forEach((value, i) =>
        expect(value).toBeCloseTo(opposite(e)[i]),
      );
      expect(snap.guides.some((g) => g.kind === "size")).toBe(true);
    },
  );
  it("matches compatible edge constraints on both axes", () => {
    const e = rect("moving", 100, 100);
    const others = layoutObjects(slide([rect("target", 400, 400)]), null);
    const snap = snapResize([e], 198, 237, "se", false, others, container, 1);
    const output = resizeSelection([e], snap.dx, snap.dy, "se", false)[0];
    expect(output.x + output.width).toBeCloseTo(400);
    expect(output.y + output.height).toBeCloseTo(400);
    expect(snap.memory).toHaveLength(2);
  });
  it("keeps ratios when independent size targets cannot both be achieved", () => {
    const image = newElement("image", {
      id: "i",
      x: 300,
      y: 300,
      width: 100,
      height: 50,
    });
    const objects = layoutObjects(
      slide([rect("target", 1500, 1500, 120, 62)]),
      null,
    );
    const snap = snapResize([image], 18, 9, "se", false, objects, container, 1);
    const output = resizeSelection([image], snap.dx, snap.dy, "se", false)[0];
    expect(output.width / output.height).toBe(2);
    expect(snap.memory).toHaveLength(1);
    expect(
      Math.min(Math.abs(output.width - 120), Math.abs(output.height - 62)),
    ).toBeLessThan(0.001);
  });
  it("prefers edges over dimensions at equal distance; skips out of range constraints", () => {
    const e = rect("moving", 100, 100, 100, 60);
    const objects = layoutObjects(
      slide([rect("target", 300, 1000, 200, 500)]),
      null,
    );
    const result = snapResize([e], 98, 0, "e", false, objects, container, 1);
    expect(result.guides[0].kind).toBe("align");
    const big = snapResize([e], 99999, 0, "e", false, objects, container, 1);
    expect(big.guides).toEqual([]);
  });
});
