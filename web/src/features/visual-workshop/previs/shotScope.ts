import {
  validateScene,
  type SceneDocument,
} from "../../../../vendor/toonflow/trumanHost";
type NativeObject = {
  id: string;
  position: unknown;
  rotation: unknown;
  navigation?: unknown;
  [key: string]: unknown;
};
type NativeScene = {
  objects: NativeObject[];
  cameras?: unknown[];
  timeline?: unknown;
  view: unknown;
  life?: unknown;
  gridVisible: boolean;
  [key: string]: unknown;
};
import type { Shot } from "../storyboard/api";
const encode = (value: unknown) => JSON.stringify(value);
const native = (value: SceneDocument) =>
  validateScene(value) as unknown as NativeScene;
const omit = (value: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
const objectStructure = (object: NativeObject) =>
  omit(object, [
    "position",
    "rotation",
    "navigation",
    "height",
    "gravityEnabled",
  ]);
const stageStructure = (value: NativeScene) => ({
  ...omit(value, [
    "objects",
    "cameras",
    "timeline",
    "view",
    "life",
    "gridVisible",
    "time",
  ]),
  objects: value.objects.map(objectStructure),
});
/** Shared geometry is immutable in a shot session. Only explicit per-shot values persist. */
export function shotOverrides(
  base: SceneDocument,
  value: SceneDocument,
): NonNullable<NonNullable<Shot["previs"]>["overrides"]> {
  const stage = native(base),
    shot = native(value);
  if (encode(stageStructure(stage)) !== encode(stageStructure(shot)))
    throw new Error(
      "当前镜头只能调整机位、走位和动作；请切换到共享舞台修改结构、素材或灯光。",
    );
  const objects = shot.objects.flatMap((object) => {
    const previous = stage.objects.find((entry) => entry.id === object.id)!;
    const patch: Record<string, unknown> = { id: object.id };
    for (const field of ["position", "rotation", "navigation"] as const) {
      if (encode(object[field]) !== encode(previous[field]))
        patch[field] = object[field] ?? null;
    }
    return Object.keys(patch).length > 1 ? [patch] : [];
  });
  return {
    objects,
    ...Object.fromEntries(
      (["cameras", "timeline", "view", "life"] as const).flatMap((field) =>
        shot[field] === undefined ? [] : [[field, shot[field]]],
      ),
    ),
  };
}
export function composeShot(base: SceneDocument, link: Shot["previs"]) {
  if (!link) return validateScene(base);
  const stage = native(base);
  const overrides = link.overrides ?? {};
  const patches = Array.isArray(overrides.objects)
    ? (overrides.objects as Record<string, unknown>[])
    : [];
  const document = {
    ...stage,
    ...overrides,
    objects: stage.objects.map((object) => {
      const patch = patches.find((item) => item.id === object.id);
      return patch
        ? {
            ...object,
            ...patch,
            ...(patch.navigation === null ? { navigation: undefined } : {}),
          }
        : object;
    }),
  };
  return validateScene(document);
}

/** New stages can be used immediately: this camera belongs to the shot only. */
export function ensureShotCamera(
  document: SceneDocument,
  shot: Pick<Shot, "id" | "title" | "duration">,
) {
  const cameras = (document.cameras ?? []) as {
    id: string;
    name: string;
    frame: unknown;
    shots?: unknown[];
  }[];
  const view = document.view as { position: unknown; target: unknown };
  const camera = cameras[0] ?? {
    id: `shot-camera-${shot.id}`,
    name: shot.title,
    frame: { position: view.position, target: view.target, focalLength: 35 },
  };
  if (camera.shots?.length) return document;
  return validateScene({
    ...document,
    cameras: [
      {
        ...camera,
        shots: [
          {
            id: `shot-segment-${shot.id}`,
            start: 0,
            end: Math.max(0.2, shot.duration ?? 5),
            frame: camera.frame,
          },
        ],
      },
      ...cameras.slice(1),
    ],
  });
}
