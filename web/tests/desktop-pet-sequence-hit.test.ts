import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPet } from "@features/desktop-pet/whale-vendor/pet-core.js";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import { readFrameSequences } from "@features/desktop-pet/sequences/validation";
import type { SequenceRect } from "@features/desktop-pet/sequences/types";
import type {
  LoadedWhaleFigure,
  WhaleFrame,
} from "@features/desktop-pet/whale-vendor/whale/figure.js";

const NS = "http://www.w3.org/2000/svg";
const box: SequenceRect = [0, 0, 343.86833153607927, 343.86833153607927];
// Registered four-cel crown/face-bottom appearance proxies from held-coat-native-v4
// package-preflight.json (package SHA 38264ed6a65b9442f4ef4c59ba3073f6bb00a61803ed8fbac068c9b6f9bb1d87).
// Author uncertainty is ±3 source px; these are interaction landmarks, not skull bones.
const nativeHeads = [
  [
    [839.8520375623206, 446.2611303635613],
    [891.5618545972345, 809.4324034924925],
  ],
  [
    [844.6622531004522, 447.4636842480942],
    [895.1695162508333, 811.8375112615583],
  ],
  [
    [831.4341603705905, 443.8560225944956],
    [889.1567468281688, 810.6349573770253],
  ],
  [
    [831.4341603705905, 446.2611303635613],
    [889.1567468281689, 810.6349573770253],
  ],
];
const face = { eyes: [], gap: [] };
const frame = (t: number): WhaleFrame => ({
  t,
  mode: "idle",
  swing: 0,
  sit: 0,
  look: [0, 0],
  legs: [],
});
const point = (x: number, y: number, rect = box) => ({
  x: rect[0] + ((x + 0.5) * rect[2]) / 1254,
  y: rect[1] + ((y + 0.5) * rect[3]) / 1254,
});
const pixelAlpha = (src: string, sx: number, sy: number) => {
  const second = sx >= 1454;
  const x = sx - (second ? 1454 : 100),
    y = sy - 200;
  if (src.includes("other")) return 0;
  if (second) return x >= 250 && x < 260 && y >= 250 && y < 260 ? 253 : 0;
  // Opaque face/boot coordinates come from the native held-cel hit audit.
  if (x >= 880 && x < 890 && y >= 765 && y < 775) return 253;
  if (x >= 630 && x < 640 && y >= 980 && y < 990) return 253;
  if (x >= 895 && x < 905 && y >= 945 && y < 955) return 253;
  if (x >= 532 && x < 542 && y >= 781 && y < 791) return 253;
  if (y >= 300 && y < 310) {
    if (x >= 300 && x < 310) return 1;
    if (x >= 310 && x < 320) return 24;
    if (x >= 320 && x < 330) return 25;
  }
  return 0;
};

const decode = vi
  .fn<(src: string) => Promise<void>>()
  .mockResolvedValue(undefined);
class TestImage {
  src = "";
  naturalWidth = 3000;
  naturalHeight = 1500;
  decode() {
    return decode(this.src);
  }
}
let readFailure = false;
let missingContext = false;
const mainDraw = vi.fn();
const pixelDraw = vi.fn();
const pixelRead = vi.fn();
const contexts: { canvas: HTMLCanvasElement; options?: unknown }[] = [];
beforeEach(() => {
  readFailure = false;
  missingContext = false;
  contexts.length = 0;
  decode.mockReset().mockResolvedValue(undefined);
  mainDraw.mockReset();
  pixelDraw.mockReset();
  pixelRead.mockReset();
  vi.stubGlobal("Image", TestImage);
  // jsdom has no pixel canvas. This controlled CPU backend checks the exact
  // original-atlas crop and 1x1 read; native/browser pixels require the E2E audit.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement, _kind: unknown, options?: unknown) {
      contexts.push({ canvas: this, options });
      if (this.width === 1 && missingContext) return null;
      const samplePixel = this.width === 1;
      let pixel: [TestImage, number, number] | null = null;
      return {
        clearRect: vi.fn(),
        drawImage(image: TestImage, ...args: number[]) {
          if (samplePixel) {
            pixelDraw(image, ...args);
            pixel = [image, args[0], args[1]];
          } else mainDraw(image, ...args);
        },
        getImageData(...args: number[]) {
          pixelRead(...args);
          if (readFailure) throw new DOMException("tainted", "SecurityError");
          return {
            data: new Uint8ClampedArray([
              0,
              0,
              0,
              pixel ? pixelAlpha(pixel[0].src, pixel[1], pixel[2]) : 0,
            ]),
          };
        },
      } as unknown as CanvasRenderingContext2D;
    } as HTMLCanvasElement["getContext"],
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function base(): LoadedWhaleFigure {
  let scheme = "classic";
  return {
    fixedScale: true,
    get scheme() {
      return scheme;
    },
    motionFacing: () => 1,
    setScheme: vi.fn((id: string) => {
      scheme = id;
    }),
    draw: vi.fn(),
    reset: vi.fn(),
    preload: async () => {},
  };
}
function sequence(
  rect = box,
  head = [
    [700, 0],
    [700, 365],
  ],
) {
  const cel = (x: number) => ({
    texture: "sheet",
    rect: [x, 200, 1254, 1254],
    durationMs: 100,
    grip: [627, 700],
    foot: [637, 1039],
    head,
  });
  return readFrameSequences({
    version: 1,
    frameSize: [1254, 1254],
    modelBox: rect,
    headLength:
      (Math.hypot(head[1][0] - head[0][0], head[1][1] - head[0][1]) * rect[2]) /
      1254,
    clips: { idle: { loop: true, frames: [cel(100), cel(1454)] } },
    transitions: [],
  })!;
}
function setup(rect = box, head?: number[][]) {
  const standing = base();
  const figure = createSequenceFigure({
    base: standing,
    sequences: sequence(rect, head),
    scheme: "classic",
    defaultScheme: "classic",
    asset: (path) => `/authorized/${path}`,
  });
  const group = document.createElementNS(NS, "g");
  return {
    figure,
    group,
    standing,
    draw(t: number, options: Partial<WhaleFrame> = {}) {
      figure.draw(group, face, { ...frame(t), ...options });
    },
  };
}
function core(figure?: LoadedWhaleFigure, scale = 0.7933, startX = 200) {
  const group = document.createElementNS(NS, "g");
  const pet = createPet(
    {
      petG: group,
      shadowEl: document.createElementNS(NS, "ellipse"),
      fxG: document.createElementNS(NS, "g"),
    },
    {
      ...(figure ? { figure } : {}),
      bounds: () => ({ W: 400, H: 400, S: scale, floorY: 340 }),
      startX,
      roam: "off",
      sfx: new Proxy({}, { get: () => () => {} }),
    },
  );
  pet.resize();
  pet.render();
  return { pet, group };
}
function project(group: SVGGElement, p: { x: number; y: number }) {
  const text = group.getAttribute("transform")!;
  const values = (kind: string) =>
    text
      .match(new RegExp(kind + "\\(([^)]+)\\)"))![1]
      .split(" ")
      .map(Number);
  const [x, y] = values("translate"),
    [sx, sy] = values("scale"),
    [angle] = values("rotate");
  const [ax, ay] = text
    .match(/translate\(([^)]+)\)$/)![1]
    .split(" ")
    .map(Number);
  const r = (angle * Math.PI) / 180,
    dx = (p.x + ax) * sx,
    dy = (p.y + ay) * sy;
  return {
    x: x + dx * Math.cos(r) - dy * Math.sin(r),
    y: y + dx * Math.sin(r) + dy * Math.cos(r),
  };
}

describe("painted whole-sequence hit admission", () => {
  it.each(nativeHeads)(
    "classifies the actual registered head axis %j after alpha admission",
    async (...head) => {
      const h = setup(box, head);
      expect(h.figure.classifyHit?.(point(885, 768))).toBeNull();
      await h.figure.preload();
      h.draw(0);
      const paints = mainDraw.mock.calls.length;
      for (let i = 0; i < 3; i++) {
        expect(h.figure.classifyHit?.(point(885, 768))).toBe("head");
        for (const [x, y] of [
          [634, 985],
          [900, 950],
          [537, 786],
        ])
          expect(h.figure.classifyHit?.(point(x, y))).toBe("body");
        for (const [x, y] of [
          [467, 467],
          [305, 305],
          [315, 305],
        ])
          expect(h.figure.classifyHit?.(point(x, y))).toBeNull();
      }
      expect(mainDraw).toHaveBeenCalledTimes(paints);
      expect(decode).toHaveBeenCalledTimes(1);
    },
  );

  it("classifies the painted sample head with its translation, then the next painted cel", async () => {
    const rect: SequenceRect = [-30, 45, box[2], box[3]];
    const h = setup(rect, nativeHeads[0]);
    await h.figure.preload();
    h.draw(0);
    const face = point(885, 768, rect);
    const grip = point(627, 700, rect);
    h.draw(0.09, { gripPoint: [grip.x + 80, grip.y - 35] });
    const translated = {
      x: face.x + 80 + box[2] / 1254 / 2,
      y: face.y - 35 + box[3] / 1254 / 2,
    };
    expect(h.figure.classifyHit?.(translated)).toBe("head");
    expect(h.figure.classifyHit?.(face)).toBeNull();
    h.draw(0.19);
    expect(h.figure.classifyHit?.(face)).toBeNull();
    // The synthetic second atlas cel's opaque patch lies outside the real head axis.
    const next = point(255, 255, rect);
    const nextTranslated = {
      x: next.x + translated.x - face.x,
      y: next.y + translated.y - face.y,
    };
    expect(h.figure.classifyHit?.(nextTranslated)).toBe("body");
    readFailure = true;
    expect(h.figure.classifyHit?.(nextTranslated)).toBeNull();
    h.figure.dispose?.();
    expect(h.figure.classifyHit?.(translated)).toBeNull();
  });

  it("reserves undefined for actually visible unsupported base artwork", () => {
    const h = setup();
    h.standing.draw = (group) => {
      group.append(document.createElementNS(NS, "path"));
    };
    expect(h.figure.classifyHit?.(point(885, 768))).toBeNull();
    h.draw(0);
    expect(h.figure.classifyHit?.(point(885, 768))).toBeUndefined();
    h.standing.classifyHit = () => "body";
    expect(h.figure.classifyHit?.(point(885, 768))).toBe("body");
    expect(h.figure.classifyHit?.({ x: NaN, y: 0 })).toBeNull();
  });

  it("hits the native-audit face/boot beyond the old circle and misses its transparent center", async () => {
    const h = setup();
    await h.figure.preload();
    const c = core(h.figure);
    for (const p of [point(885, 768), point(634, 985)]) {
      expect(Math.hypot(p.x - 128, p.y - 128)).toBeGreaterThan(108);
      expect(c.pet.hitPet(project(c.group, p))).toBe(true);
    }
    expect(c.pet.hitPet(project(c.group, point(467, 467)))).toBe(false);
    expect(pixelDraw).toHaveBeenLastCalledWith(
      expect.any(TestImage),
      567,
      667,
      1,
      1,
      0,
      0,
      1,
      1,
    );
  });

  it("keeps the alpha >24 boundary, reuses one CPU pixel surface and never repaints/redecodes on moves", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    const paints = mainDraw.mock.calls.length;
    for (let i = 0; i < 10; i++) {
      expect(h.figure.hitTest?.(point(305, 305))).toBe(false);
      expect(h.figure.hitTest?.(point(315, 305))).toBe(false);
      expect(h.figure.hitTest?.(point(325, 305))).toBe(true);
    }
    expect(decode).toHaveBeenCalledTimes(1);
    expect(mainDraw).toHaveBeenCalledTimes(paints);
    const samplers = contexts.filter(({ canvas }) => canvas.width === 1);
    expect(samplers).toHaveLength(1);
    expect(samplers[0].options).toEqual({ willReadFrequently: true });
    expect(
      pixelRead.mock.calls.every((args) => args.join() === "0,0,1,1"),
    ).toBe(true);
  });

  it("maps offset modelBox, atlas rect, painted pose and grip translation rather than stale or prospective cels", async () => {
    const rect: SequenceRect = [-30, 45, box[2], box[3]];
    const h = setup(rect);
    await h.figure.preload();
    h.draw(0);
    expect(h.figure.hitTest?.(point(885, 768, rect))).toBe(true);
    h.draw(0.09);
    expect(h.figure.hitTest?.(point(885, 768, rect))).toBe(true);
    h.draw(0.19);
    expect(h.figure.hitTest?.(point(885, 768, rect))).toBe(false);
    expect(h.figure.hitTest?.(point(255, 255, rect))).toBe(true);
    const before = mainDraw.mock.calls.length;
    const grip = point(627, 700, rect);
    h.draw(0.195, { gripPoint: [grip.x + 80, grip.y - 35] });
    const translated = point(255, 255, rect);
    expect(h.figure.hitTest?.(translated)).toBe(false);
    const shift = { x: 80 + box[2] / 1254 / 2, y: -35 + box[3] / 1254 / 2 };
    expect(
      h.figure.hitTest?.({
        x: translated.x + shift.x,
        y: translated.y + shift.y,
      }),
    ).toBe(true);
    expect(mainDraw).toHaveBeenCalledTimes(before);
    expect(pixelDraw.mock.calls.at(-1)?.slice(1, 3)).toEqual([1709, 455]);
  });

  it("leaves the visible old cel owning hits while a new scheme is waiting or decode fails", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    await h.figure.setScheme("other");
    decode.mockRejectedValueOnce(new Error("decode unavailable"));
    h.draw(0.01);
    expect(h.figure.hitTest?.(point(885, 768))).toBe(true);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    h.draw(0.02);
    expect(h.figure.hitTest?.(point(885, 768))).toBe(true);
    expect(h.figure.getAssetFailure?.()).toBe("decode unavailable");
  });

  it("fails closed on invalid points, missing CPU context or CORS read failure and releases owned surface", async () => {
    const h = setup();
    expect(h.figure.hitTest?.({ x: NaN, y: 0 })).toBe(false);
    expect(h.figure.hitTest?.(point(885, 768))).toBeNull();
    await h.figure.preload();
    h.draw(0);
    for (const p of [
      { x: Infinity, y: 0 },
      { x: -1, y: 0 },
      { x: box[2], y: 0 },
    ])
      expect(h.figure.hitTest?.(p)).toBe(false);
    missingContext = true;
    expect(h.figure.hitTest?.(point(885, 768))).toBe(false);
    expect(h.figure.getAssetFailure?.()).toBe("完整序列帧点击区域读取失败");
    missingContext = false;
    h.figure.retryAssetLoad?.();
    readFailure = true;
    expect(h.figure.hitTest?.(point(885, 768))).toBe(false);
    const reads = pixelRead.mock.calls.length;
    expect(h.figure.hitTest?.(point(885, 768))).toBe(false);
    expect(pixelRead).toHaveBeenCalledTimes(reads);
    readFailure = false;
    h.figure.retryAssetLoad?.();
    expect(h.figure.hitTest?.(point(885, 768))).toBe(true);
    const surface = contexts.find(({ canvas }) => canvas.width === 1)!.canvas;
    h.figure.dispose?.();
    expect(surface.width).toBe(0);
    expect(h.figure.hitTest?.(point(885, 768))).toBe(false);
  });

  it("delegates visible standing artwork but never hits a cleared canvas after failed paint", async () => {
    const h = setup();
    h.standing.hitTest = () => false;
    expect(h.figure.hitTest?.(point(467, 467))).toBe(false);
    await h.figure.preload();
    h.draw(0);
    expect(h.figure.hitTest?.(point(885, 768))).toBe(true);
    mainDraw.mockImplementationOnce(() => {
      throw new Error("draw failed");
    });
    expect(() => h.draw(0.1)).toThrow("draw failed");
    expect(h.figure.hitTest?.(point(885, 768))).toBe(false);
  });

  it("a newly painted scheme can recover from a tainted previous image without a broad fallback", async () => {
    const h = setup();
    await h.figure.preload();
    h.draw(0);
    readFailure = true;
    expect(h.figure.hitTest?.(point(885, 768))).toBe(false);
    readFailure = false;
    await h.figure.setScheme("other");
    h.draw(0.01);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    h.draw(0.02);
    expect(h.figure.hitTest?.(point(885, 768))).toBe(false);
    expect(h.figure.getAssetFailure?.()).toBeNull();
    await h.figure.setScheme("classic");
    h.draw(0.03);
    expect(h.figure.hitTest?.(point(885, 768))).toBe(true);
    expect(decode).toHaveBeenCalledTimes(2);
  });
});

describe("core owns inverse stage transform and legacy fallback", () => {
  it.each([
    [1, 0],
    [-1, 0],
    [1, 37.049],
    [-1, -37.049],
  ])(
    "matches installed SVG rounding at an opaque pixel edge with facing=%s, angle=%s",
    async (facing, angle) => {
      const h = setup(box, nativeHeads[0]);
      await h.figure.preload();
      h.figure.groupFacing = () => facing;
      h.figure.groupTilt = () => angle;
      const c = core(h.figure, 0.793349, 200.049);
      const model = {
        x: (880.1 * box[2]) / 1254,
        y: (768.5 * box[3]) / 1254,
      };
      expect(h.figure.hitTest?.(model)).toBe(true);
      expect(c.pet.hitPet(project(c.group, model))).toBe(true);
      expect(c.pet.classifyHit(project(c.group, model))).toBe("head");
      expect(pixelDraw.mock.calls.at(-1)?.slice(1, 3)).toEqual([980, 968]);
      const transparentNeighbor = { ...model, x: (879.9 * box[2]) / 1254 };
      expect(c.pet.hitPet(project(c.group, transparentNeighbor))).toBe(false);
      expect(
        c.pet.classifyHit(project(c.group, transparentNeighbor)),
      ).toBeNull();
    },
  );

  it.each([
    [1, true],
    [-1, true],
    [-1, false],
  ])(
    "passes model coordinates through facing=%s, fixedScale=%s and rotation",
    (facing, fixedScale) => {
      const f = base();
      f.fixedScale = Boolean(fixedScale);
      f.groupFacing = () => facing as 1 | -1;
      f.groupTilt = () => 37;
      const hit = vi.fn(
        (p: { x: number; y: number }) =>
          Math.abs(p.x - 243) < 0.1 && Math.abs(p.y - 210) < 0.1,
      );
      f.hitTest = hit;
      const c = core(f, 1.375);
      if (!fixedScale) {
        c.pet.step(0.05);
        c.pet.render();
        const scales = c.group
          .getAttribute("transform")!
          .match(/scale\(([^)]+)\)/)![1]
          .split(" ")
          .map(Number);
        expect(Math.abs(scales[0])).not.toBe(scales[1]);
      }
      expect(c.pet.hitPet(project(c.group, { x: 243, y: 210 }))).toBe(true);
      expect(hit.mock.calls.at(-1)![0].x).toBeCloseTo(243, 2);
      expect(hit.mock.calls.at(-1)![0].y).toBeCloseTo(210, 2);
      expect(c.pet.hitPet(project(c.group, { x: 128, y: 128 }))).toBe(false);
      expect(c.pet.hitPet({ x: NaN, y: 0 })).toBe(false);
    },
  );

  it("null standing fallback and absent API retain the old circle, but explicit false cannot fall back", () => {
    for (const figure of [undefined, base()]) {
      const c = core(figure);
      expect(c.pet.hitPet(project(c.group, { x: 128, y: 128 }))).toBe(true);
      expect(c.pet.hitPet(project(c.group, { x: 243, y: 210 }))).toBe(false);
    }
    const f = base();
    f.hitTest = () => null;
    const c = core(f);
    expect(c.pet.hitPet(project(c.group, { x: 128, y: 128 }))).toBe(true);
    f.hitTest = () => false;
    expect(c.pet.hitPet(project(c.group, { x: 128, y: 128 }))).toBe(false);
    const singular = core(f, 0);
    expect(singular.pet.hitPet({ x: 200, y: 340 })).toBe(false);
  });
});
