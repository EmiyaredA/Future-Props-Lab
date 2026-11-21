import { expect, test, vi } from "vitest";
import { locateExcerpt } from "@features/visual-workshop/storyboard/scriptSource";
import { adoptReferenceDraft } from "@features/visual-workshop/previs/adoptReference";
import {
  composeShot,
  shotOverrides,
} from "@features/visual-workshop/previs/shotScope";
import type {
  GenerationOptions,
  VisualCanvasNode,
} from "@features/visual-workshop/api";
vi.mock("../../vendor/toonflow/trumanHost", () => ({
  validateScene: (value: unknown) => structuredClone(value),
}));
const options = {
  models: [
    {
      id: "h3",
      kind: "video",
      video_capabilities: {
        supported_modes: ["reference"],
        reference_limits: { image: 2, video: 1 },
      },
    },
  ],
} as unknown as GenerationOptions;
const node = {
  id: "clip",
  kind: "video",
  generation_draft: {
    model_id: "h3",
    prompt: "@图片1 @视频1",
    reference_asset_ids: ["a", "b"],
    video_asset_ids: ["v"],
    reference_order: ["asset:a", "asset:b"],
    reference_subjects: { "asset:a": "character" },
    design_references: [{ asset_id: "a", card_id: "person" }],
  },
} as unknown as VisualCanvasNode;
test("script offset counts UTF-16; unique quote survives moving and ambiguous quotes require repair", () => {
  const source = {
    scene_id: "s",
    revision: 1,
    excerpt: "开场",
    start: 2,
    end: 4,
  };
  expect(locateExcerpt("🙂开场对白", source)).toEqual({ start: 2, end: 4 });
  expect(locateExcerpt("新增前文。🙂开场对白", source)).toEqual({
    start: 7,
    end: 9,
  });
  expect(
    locateExcerpt("开场，开场", { ...source, start: null, end: null }),
  ).toBeUndefined();
});
test("replacement preserves input order, aliases, prompt and unrelated media", () => {
  expect(
    adoptReferenceDraft(node, "image", "new", "a", options).draft,
  ).toMatchObject({
    prompt: "@图片1 @视频1",
    reference_asset_ids: ["new", "b"],
    video_asset_ids: ["v"],
    reference_order: ["asset:new", "asset:b"],
    reference_subjects: { "asset:new": "character" },
    design_references: [],
  });
  expect(
    (node as Extract<VisualCanvasNode, { kind: "video" }>).generation_draft
      ?.reference_asset_ids,
  ).toEqual(["a", "b"]);
  expect(() => adoptReferenceDraft(node, "image", "new", "", options)).toThrow(
    "最多接收",
  );
  expect(() =>
    adoptReferenceDraft(node, "image", "new", "a", options, ["linked"]),
  ).toThrow("最多接收");
  expect(() =>
    adoptReferenceDraft(node, "video", "new", "deleted", options),
  ).toThrow("已变化");
});
test("shot staging cannot modify shared geometry", () => {
  const base = {
    version: 1,
    gridVisible: true,
    view: {},
    objects: [
      {
        id: "a",
        name: "A",
        asset: {},
        position: { x: 0 },
        rotation: {},
        scale: { x: 1 },
      },
    ],
  };
  const document = structuredClone(base);
  document.objects[0].position.x = 3;
  const overrides = shotOverrides(base, document);
  expect(overrides.objects).toEqual([{ id: "a", position: { x: 3 } }]);
  expect(
    composeShot(base, { scene_id: "scene", stage_revision: 0, overrides }),
  ).toMatchObject({ objects: [{ position: { x: 3 } }] });
  expect(base.objects[0].position.x).toBe(0);
  document.objects[0].scale.x = 2;
  expect(() => shotOverrides(base, document)).toThrow("共享舞台");
});
