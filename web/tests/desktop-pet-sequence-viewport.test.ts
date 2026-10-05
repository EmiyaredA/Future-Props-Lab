import { afterEach, expect, test, vi } from "vitest";
import { createPet } from "@features/desktop-pet/whale-vendor/pet-core.js";
import { petViewportBounds } from "@features/desktop-pet/sequences/viewport";
import { readFrameSequences } from "@features/desktop-pet/sequences/validation";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import type { LoadedWhaleFigure } from "@features/desktop-pet/whale-vendor/whale/figure.js";
import type { SequenceRect } from "@features/desktop-pet/sequences/types";

const NS = "http://www.w3.org/2000/svg";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function sequences(box: SequenceRect) {
  const frame = (texture: string) => ({
    texture,
    rect: [0, 0, 100, 100],
    durationMs: 100,
    grip: [50, 50],
    foot: [50, 90],
    head: [
      [50, 10],
      [50, 20],
    ],
  });
  return readFrameSequences({
    version: 1,
    frameSize: [100, 100],
    modelBox: box,
    headLength: box[2] / 10,
    clips: { idle: { loop: true, frames: [frame("a"), frame("b")] } },
    transitions: [],
  })!;
}
function create(
  figure: LoadedWhaleFigure,
  box: SequenceRect,
  view: "center" | "floor" = "center",
  inPlace = true,
) {
  const group = document.createElementNS(NS, "g");
  let size = [540, 392];
  const bounds = () =>
    petViewportBounds(size[0], size[1], view, sequences(box));
  const pet = createPet(
    {
      petG: group,
      shadowEl: document.createElementNS(NS, "ellipse"),
      fxG: document.createElementNS(NS, "g"),
    },
    {
      figure,
      sfx: new Proxy({}, { get: () => () => {} }),
      bounds,
      startX: 270,
      roam: "off",
      walkInPlace: inPlace,
    },
  );
  return {
    pet,
    group,
    bounds,
    resize(w: number, h: number) {
      size = [w, h];
      pet.resize();
      pet.render();
    },
  };
}
function matrix(group: SVGGElement) {
  const raw = group.getAttribute("transform")!;
  const values = (kind: string) =>
    raw
      .match(new RegExp(kind + "\\(([^)]+)\\)"))![1]
      .split(" ")
      .map(Number);
  const [x, y] = values("translate"),
    [sx, sy] = values("scale");
  const angle = (values("rotate")[0] * Math.PI) / 180;
  const tail = raw
    .match(/translate\(([^)]+)\)$/)![1]
    .split(" ")
    .map(Number);
  return (p: readonly number[]) => [
    x +
      (p[0] + tail[0]) * sx * Math.cos(angle) -
      (p[1] + tail[1]) * sy * Math.sin(angle),
    y +
      (p[0] + tail[0]) * sx * Math.sin(angle) +
      (p[1] + tail[1]) * sy * Math.cos(angle),
  ];
}
function basic(): LoadedWhaleFigure {
  return {
    fixedScale: true,
    groupFacing: () => 1,
    motionFacing: () => 1,
    groupTilt: () => 0,
    pickupPoint: () => [128, 188],
    scheme: "classic",
    preload: async () => {},
    draw: () => {},
    reset: () => {},
    setScheme: () => {},
  };
}

for (const box of [
  [0, 0, 358, 358],
  [-300, -300, 300, 300],
  [300, 256, 150, 150],
] satisfies SequenceRect[]) {
  test(`real core central camera fits common modelBox ${box} and recenters every resize`, () => {
    const scene = create(basic(), box);
    for (const [w, h] of [
      [540, 392],
      [240, 280],
      [80, 100],
      [20, 24],
    ]) {
      scene.resize(w, h);
      scene.pet.step(1 / 60);
      scene.pet.render();
      const project = matrix(scene.group),
        [x, y, bw, bh] = box;
      const corners = [
        [x, y],
        [x + bw, y],
        [x + bw, y + bh],
        [x, y + bh],
      ].map(project);
      for (const [cx, cy] of corners) {
        expect(cx).toBeGreaterThanOrEqual(-0.1);
        expect(cy).toBeGreaterThanOrEqual(-0.1);
        expect(cx).toBeLessThanOrEqual(w + 0.1);
        expect(cy).toBeLessThanOrEqual(h + 0.1);
      }
      const center = project([x + bw / 2, y + bh / 2]);
      expect(center[0]).toBeCloseTo(w / 2, 0);
      expect(center[1]).toBeCloseTo(h / 2, 0);
    }
  });
}

test("actual sequence cel change installs the same common canvas camera and preserves scale", async () => {
  class ImageStub {
    src = "";
    naturalWidth = 100;
    naturalHeight = 100;
    async decode() {}
  }
  vi.stubGlobal("Image", ImageStub);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({
      clearRect: vi.fn(),
      drawImage,
    })) as unknown as HTMLCanvasElement["getContext"],
  );
  const seq = sequences([-300, -300, 300, 300]);
  const figure = createSequenceFigure({
    base: basic(),
    sequences: seq,
    scheme: "classic",
    defaultScheme: "classic",
    asset: (p) => p,
  });
  const scene = create(figure, seq.modelBox);
  await figure.preload();
  scene.pet.render();
  const first = scene.group.getAttribute("transform");
  expect(drawImage).toHaveBeenCalledTimes(1);
  scene.pet.step(0.05);
  scene.pet.step(0.05);
  scene.pet.step(0.02);
  scene.pet.render();
  expect(drawImage).toHaveBeenCalledTimes(2);
  expect(scene.group.getAttribute("transform")).toBe(first);
  const fo = scene.group.querySelector("foreignObject")!;
  expect(
    ["x", "y", "width", "height"].map((k) => Number(fo.getAttribute(k))),
  ).toEqual(seq.modelBox);
  figure.dispose?.();
});

test("floor sequence and missing-sequence center retain exact legacy bounds", () => {
  const seq = sequences([0, 0, 358, 358]);
  expect(petViewportBounds(540, 392, "floor", seq)).toEqual({
    W: 540,
    H: 392,
    S: 1.53125,
    floorY: 384,
  });
  expect(petViewportBounds(540, 392, "center", null)).toEqual({
    W: 540,
    H: 392,
    S: 1.53125,
    floorY: 392,
  });
  expect(petViewportBounds(0, 0, "center", seq)).toEqual({
    W: 0,
    H: 0,
    S: 0,
    floorY: 0,
  });
});

test("resize camera does not replace an existing held cursor anchor", () => {
  const scene = create(basic(), [-300, -300, 300, 300]);
  scene.pet.render();
  scene.pet.setLocomotion({
    state: "held",
    phase: 0,
    facing: 1,
    velocity: { x: 0, y: 0 },
    edge: null,
    swing: 0,
    grip: { x: 150, y: 140 },
  });
  scene.pet.step(0.05);
  scene.pet.render();
  for (const [w, h] of [
    [240, 280],
    [80, 100],
  ]) {
    scene.resize(w, h);
    scene.pet.step(0.05);
    scene.pet.render();
    // At rest, once the220ms pickup blend completes the actual pickup stays on cursor.
  }
  scene.pet.step(0.05);
  scene.pet.step(0.05);
  scene.pet.render();
  const pickup = matrix(scene.group)([128, 188]);
  expect(pickup[0]).toBeCloseTo(150, 0);
  expect(pickup[1]).toBeCloseTo(140, 0);
});

test("non-in-place callers ignore camera centerX and invalid camera values retain old clamp", () => {
  const group = document.createElementNS(NS, "g");
  let center: number | undefined = 999;
  const options = {
    figure: basic(),
    sfx: {},
    roam: "off",
    startX: 120,
    walkInPlace: false,
    bounds: () => ({ W: 540, H: 392, floorY: 384, S: 1, centerX: center }),
  };
  const pet = createPet(
    {
      petG: group,
      shadowEl: document.createElementNS(NS, "ellipse"),
      fxG: document.createElementNS(NS, "g"),
    },
    options,
  );
  pet.render();
  expect(matrix(group)([128, 256])[0]).toBe(120);
  options.walkInPlace = true;
  center = NaN;
  pet.resize();
  pet.render();
  expect(matrix(group)([128, 256])[0]).toBe(120);
});
