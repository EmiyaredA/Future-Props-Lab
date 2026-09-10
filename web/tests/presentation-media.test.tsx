import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { cropGesture } from "@features/presentation-workshop/cropGeometry";
import { newElement } from "@features/presentation-workshop/templates";
import { SelectionMediaTools } from "@features/presentation-workshop/SelectionMediaTools";
import {
  polygonFor,
  shapeCatalog,
} from "@features/presentation-workshop/shapeCatalog";

describe("图片裁剪局部坐标", () => {
  const base = newElement("image", {
    width: 400,
    height: 200,
    x: 100,
    y: 100,
    crop: { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 },
  });
  it("拖动裁剪边缘保持对边的位置并只返回临时补丁", () => {
    const result = cropGesture(
      base,
      { width: 800, height: 400 },
      "w",
      40,
      0,
      null,
    );
    expect(result.width).toBeCloseTo(360);
    expect(result.x).toBeCloseTo(140);
    expect(result.crop?.left).toBeCloseTo(0.18);
    expect(base.crop.left).toBe(0.1);
  });
  it("旋转 90 度后的屏幕纵向移动对应本地横向裁剪", () => {
    const result = cropGesture(
      { ...base, rotation: 90 },
      { width: 800, height: 400 },
      "w",
      0,
      40,
      null,
    );
    expect(result.width).toBeCloseTo(360);
    expect(result.x).toBeCloseTo(120);
    expect(result.y).toBeCloseTo(120);
  });
  it("翻转图片交换源图裁剪边，画框仍在正确方向缩小", () => {
    const result = cropGesture(
      { ...base, flip_x: true },
      { width: 800, height: 400 },
      "e",
      -40,
      0,
      null,
    );
    expect(result.width).toBeCloseTo(360);
    expect(result.crop?.left).toBeCloseTo(0.18);
    expect(result.x).toBeCloseTo(100);
  });
  it("平移不改变裁剪区域大小并在原图边缘限位", () => {
    const result = cropGesture(
      base,
      { width: 800, height: 400 },
      "move",
      10000,
      10000,
      null,
    );
    expect(result.crop?.left).toBe(0);
    expect(result.crop?.right).toBeCloseTo(0.2);
    expect(result.crop?.top).toBe(0);
    expect(result.crop?.bottom).toBeCloseTo(0.2);
  });
});
it("图片快捷控件分别派发替换、裁剪、翻转及预览", () => {
  const patch = vi.fn(),
    actions = {
      replace: vi.fn(),
      crop: vi.fn(),
      preview: vi.fn(),
      download: vi.fn(),
    };
  render(
    <SelectionMediaTools
      element={newElement("image")}
      patch={patch}
      actions={actions}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "更换素材" }));
  fireEvent.click(screen.getByRole("button", { name: "裁剪图片" }));
  fireEvent.click(screen.getByRole("button", { name: "水平翻转" }));
  expect(actions.replace).toHaveBeenCalledOnce();
  expect(actions.crop).toHaveBeenCalledOnce();
  expect(patch).toHaveBeenCalledWith({ flip_x: true });
});
it("矢量对象没有图片裁剪入口", () => {
  render(
    <SelectionMediaTools element={newElement("vector")} patch={() => {}} />,
  );
  expect(screen.queryByRole("button", { name: "裁剪图片" })).toBeNull();
});
it("新增形状的可编辑轮廓均有有限的坐标", () => {
  for (const shape of shapeCatalog) {
    const points = polygonFor(shape.kind, 280, 180);
    if (points) {
      const values = points.split(/[ ,]/).map(Number);
      expect(values.every(Number.isFinite)).toBe(true);
      expect(values.length).toBeGreaterThan(4);
    }
  }
});
