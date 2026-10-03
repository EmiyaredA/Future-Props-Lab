import { strToU8, zipSync } from "fflate";

/** Synthetic data-only character; visual acceptance can supply a local archive separately. */
export function petPackage() {
  const parents = {
    hair_back: "hair",
    hair_front: "bangs",
    face: "head",
    torso: "body",
    coat: "coat",
    arm_near: "armNear",
    arm_far: "armFar",
    leg_back: "legBack",
    leg_front: "legFront",
    sit_lower: "body",
  };
  const model = {
    rigProfile: "human-chibi",
    character: { name: "界面验收角色" },
    units: { S: 1, X0: 128, FEET: 256 },
    view: [0, -8, 256, 280],
    pivots: Object.fromEntries(
      ["body", "neck", "armNear", "armFar", "legBack", "legFront"].map(
        (name) => [name, [128, 128]],
      ),
    ),
    parts: Object.entries(parents).map(([id, parent], z) => ({
      id,
      tex: id,
      parent,
      z,
      box: [64, 64, 64, 64],
      grid: [2, 2],
    })),
    feat: {
      sprites: Object.fromEntries(
        [
          "eyes",
          "closed_eyes",
          "angry_eyes",
          "surprised_eyes",
          "brows",
          "neutral_mouth",
          "happy_mouth",
        ].map((name) => [name, [96, 96, 112, 112]]),
      ),
    },
    schemes: [
      { id: "classic", brand: "界面验收角色", label: "经典便服" },
      { id: "lab", brand: "界面验收角色", label: "实验室服" },
    ],
  };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJUlEQVR4nGOc5m3+n4ECwESJ5lEDIICJgULANGoAw2gYMFAeBgC9KwI3PEGUDQAAAABJRU5ErkJggg==",
    "base64",
  );
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(
      JSON.stringify({ format: "fpl-coopanion-whale", version: 1 }),
    ),
    "model.json": strToU8(JSON.stringify(model)),
  };
  model.schemes.forEach((scheme, index) => {
    const prefix = index ? `schemes/${scheme.id}/` : "";
    model.parts.forEach((part) => {
      files[`${prefix}tex/${part.tex}.png`] = png;
    });
    Object.keys(model.feat.sprites).forEach((name) => {
      files[`${prefix}feat/${name}.png`] = png;
    });
    files[`thumbs/${scheme.id}.png`] = png;
  });
  return Buffer.from(zipSync(files));
}
