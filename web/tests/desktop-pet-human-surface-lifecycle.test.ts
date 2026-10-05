import { afterEach, expect, test, vi } from "vitest";
import {
  createHumanFigure,
  type HumanFrame,
  type HumanModel,
} from "@features/desktop-pet/humanFigure";
import { createSequenceFigure } from "@features/desktop-pet/sequences/figure";
import type { FrameSequences } from "@features/desktop-pet/sequences/types";

// Production HumanFigure -> createRig/SequenceFigure, with controlled browser
// surfaces. Counts are ownership/routing, not native GPU/OS/art certification.
const model: HumanModel = {
  rigProfile: "human-chibi",
  character: { name: "surface lifecycle" },
  view: [0, 0, 100, 100],
  pivots: Object.fromEntries(
    ["body", "neck", "armNear", "armFar", "legBack", "legFront"].map((id) => [
      id,
      [50, 50],
    ]),
  ),
  parts: ["hair_back", "hair_front", "coat"].map((id, i) => ({
    id,
    tex: "atlas",
    parent: "body",
    box: [i * 10, 0, 10, 20],
    grid: [1, 1],
    uvBox: [i / 4, 0, (i + 1) / 4, 1],
    z: i,
  })),
  feat: {
    sprites: {
      eyes: [10, 10, 20, 20],
      angry_eyes: [10, 10, 20, 20],
      neutral_mouth: [10, 20, 20, 24],
    },
  },
  schemes: [
    { id: "classic", accent: "#123456" },
    { id: "lab", accent: "#234567" },
    { id: "maid", accent: "#345678" },
  ],
};
const frame = (t = 0, mode = "idle", expression = "neutral"): HumanFrame => ({
  t,
  mode,
  face: expression,
  look: [0, 0],
  legs: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  low: 0,
  swing: 0,
  sit: mode === "sit" ? 1 : 0,
  blink: 0,
  eyeClose: 0,
  talk: 0,
  tilt: 0,
  lean: 0,
});
const sequences: FrameSequences = {
  version: 1,
  frameSize: [100, 200],
  modelBox: [0, 0, 50, 100],
  headLength: 20,
  clips: {
    idle: {
      loop: true,
      frames: [
        {
          texture: "whole",
          rect: [0, 0, 100, 200],
          durationMs: 400,
          grip: [50, 70],
          foot: [50, 190],
          head: [
            [50, 10],
            [50, 50],
          ],
        },
      ],
    },
  },
  transitions: [],
};
const group = () => document.createElementNS("http://www.w3.org/2000/svg", "g");
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function browserSurfaces() {
  const requests: string[] = [],
    paused = new Set<string>(),
    broken = new Set<string>();
  const pending: { url: string; finish: () => void }[] = [];
  let decodeFailure = false,
    nullSequenceContext = false,
    throwWholePaint = false;
  let size: [number, number] = [100, 200],
    finishDecode!: () => void,
    decodeBarrier: Promise<void> | null = null;
  class Image {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 100;
    height = 200;
    naturalWidth = 100;
    naturalHeight = 200;
    private url = "";
    set src(url: string) {
      this.url = url;
      requests.push(url);
      const finish = () =>
        broken.has(url) ? this.onerror?.() : this.onload?.();
      if ([...paused].some((p) => url.startsWith(p)))
        pending.push({ url, finish });
      else queueMicrotask(finish);
    }
    get src() {
      return this.url;
    }
    async decode() {
      if (decodeFailure) throw new Error("whole decode rejected");
      [this.naturalWidth, this.naturalHeight] = size;
      await decodeBarrier;
    }
  }
  vi.stubGlobal("Image", Image);
  const gpu: {
    canvas: HTMLCanvasElement;
    releases: number;
    uploads: {
      source: { src?: string; width: number; height: number };
      size: [number, number];
    }[];
    draws: number;
    vertices: number[][];
  }[] = [];
  const surfaces2D: {
    canvas: HTMLCanvasElement;
    paints: { source: { src?: string }; args: number[] }[];
  }[] = [];
  const contexts2D = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement, kind: string) {
      if (kind === "2d") {
        if (nullSequenceContext && this.width === 100 && this.height === 200)
          return null;
        const existing = contexts2D.get(this);
        if (existing) return existing;
        const row = {
          canvas: this,
          paints: [] as (typeof surfaces2D)[number]["paints"],
        };
        surfaces2D.push(row);
        const context = new Proxy(
          {},
          {
            get: (_, key) => {
              if (key === "canvas") return this;
              if (key === "drawImage")
                return (source: { src?: string }, ...args: number[]) => {
                  if (throwWholePaint && source.src?.endsWith("/whole.png"))
                    throw new Error("actual whole paint failed");
                  row.paints.push({ source, args });
                };
              return vi.fn();
            },
          },
        ) as CanvasRenderingContext2D;
        contexts2D.set(this, context);
        return context;
      }
      const row = {
        canvas: this,
        releases: 0,
        uploads: [] as (typeof gpu)[number]["uploads"],
        draws: 0,
        vertices: [] as number[][],
      };
      gpu.push(row);
      return new Proxy(
        {},
        {
          get: (_, key) => {
            if (key === "canvas") return this;
            if (key === "getExtension")
              return () => ({ loseContext: () => row.releases++ });
            if (key === "texImage2D")
              return (...args: unknown[]) => {
                const source = args.at(-1) as HTMLCanvasElement | Image;
                row.uploads.push({
                  source,
                  size: [source.width, source.height],
                });
              };
            if (key === "drawElements") return () => row.draws++;
            if (key === "bufferSubData")
              return (_: unknown, _offset: unknown, data: Float32Array) =>
                row.vertices.push([...data]);
            if (key === "getShaderParameter" || key === "getProgramParameter")
              return () => true;
            return vi.fn(() => ({}));
          },
        },
      );
    } as unknown as HTMLCanvasElement["getContext"],
  );
  return {
    gpu,
    surfaces2D,
    requests,
    paused,
    broken,
    pauseDecode() {
      decodeBarrier = new Promise((resolve) => (finishDecode = resolve));
    },
    completeDecode() {
      finishDecode();
      decodeBarrier = null;
    },
    rejectDecode() {
      decodeFailure = true;
    },
    badSize() {
      size = [50, 100];
    },
    rejectContext() {
      nullSequenceContext = true;
    },
    paintThrows(value: boolean) {
      throwWholePaint = value;
    },
    complete(prefix: string) {
      paused.delete(prefix);
      for (let i = pending.length - 1; i >= 0; i--)
        if (pending[i].url.startsWith(prefix)) pending.splice(i, 1)[0].finish();
    },
  };
}
async function setup(surface = browserSurfaces()) {
  const base = await createHumanFigure({
    model,
    scheme: "classic",
    asset: (p) => p,
  });
  const figure = createSequenceFigure({
    base,
    sequences,
    scheme: "classic",
    defaultScheme: "classic",
    asset: (p) => p,
  });
  const target = group(),
    draw = (t = 0) => figure.draw(target, { eyes: [], gap: [] }, frame(t));
  const commit = async () => {
    await figure.preload();
    draw();
  };
  return { surface, base, figure, target, draw, commit };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("whole commit retires hidden GL/face without changing visible whole canvas or later replay", async () => {
  const h = await setup(),
    first = h.surface.gpu[0];
  expect(first.releases).toBe(0);
  await h.commit();
  expect(first.releases).toBe(1);
  expect([first.canvas.width, first.canvas.height]).toEqual([0, 0]);
  const face = h.surface.surfaces2D.find((r) =>
    r.paints.some((p) => p.source.src === "feat/eyes.png"),
  )!;
  expect([face.canvas.width, face.canvas.height]).toEqual([0, 0]);
  const active = h.target.querySelector(
    'canvas[data-pet-raster-active="true"]',
  ) as HTMLCanvasElement;
  expect([active.width, active.height]).toEqual([100, 200]);
  expect(h.target.querySelectorAll("canvas")).toHaveLength(1);
  const uploads = first.uploads.length;
  h.draw(0.1);
  h.figure.cancelMotionPlayback?.();
  h.figure.reset();
  h.draw(50);
  h.figure.rejectReactionPlayback?.("sequence:missing-clip");
  h.draw(50.1);
  expect(h.target.querySelector("canvas")).toBe(active);
  expect(h.surface.gpu).toHaveLength(1);
  expect(first.uploads).toHaveLength(uploads);
  h.figure.dispose?.();
  h.figure.dispose?.();
  expect(first.releases).toBe(1);
});

test("pending decode keeps real standing/face fallback until actual whole commit", async () => {
  const surface = browserSurfaces();
  surface.pauseDecode();
  const h = await setup(surface);
  h.draw();
  await settle();
  expect(surface.gpu[0].releases).toBe(0);
  expect(surface.gpu[0].draws).toBeGreaterThan(0);
  expect(
    surface.surfaces2D.some((r) =>
      r.paints.some((p) => p.source.src === "feat/eyes.png"),
    ),
  ).toBe(true);
  expect(h.target.querySelector('canvas[data-pet-raster-active="true"]')).toBe(
    surface.gpu[0].canvas,
  );
  surface.completeDecode();
  await h.figure.preload();
  h.draw(0.01);
  expect(surface.gpu[0].releases).toBe(1);
  h.figure.dispose?.();
});

test.each(["decode", "bounds"])(
  "initial %s failure preserves base until final ownership cleanup",
  async (failure) => {
    const surface = browserSurfaces();
    if (failure === "decode") surface.rejectDecode();
    else surface.badSize();
    const h = await setup(surface);
    h.draw();
    await h.figure.preload();
    h.draw();
    expect(h.figure.getMotionFailure?.()).toBeTruthy();
    expect(surface.gpu[0].releases).toBe(0);
    expect(
      h.target.querySelector('canvas[data-pet-raster-active="true"]'),
    ).toBe(surface.gpu[0].canvas);
    h.figure.dispose?.();
    expect(surface.gpu[0].releases).toBe(1);
  },
);

test("initial rejected reaction neither decodes nor retires; valid selection can commit", async () => {
  const h = await setup();
  h.figure.rejectReactionPlayback?.("sequence:missing-clip");
  h.draw();
  expect(h.surface.requests).not.toContain("tex/whole.png");
  expect(h.surface.gpu[0].releases).toBe(0);
  expect(h.target.querySelector('canvas[data-pet-raster-active="true"]')).toBe(
    h.surface.gpu[0].canvas,
  );
  h.figure.acceptReactionPlayback?.();
  await h.commit();
  expect(h.surface.gpu[0].releases).toBe(1);
  h.figure.dispose?.();
});

test("constructor 2D failure retains original ownership until initializer disposal", async () => {
  const surface = browserSurfaces(),
    base = await createHumanFigure({
      model,
      scheme: "classic",
      asset: (p) => p,
    });
  surface.rejectContext();
  expect(() =>
    createSequenceFigure({
      base,
      sequences,
      scheme: "classic",
      defaultScheme: "classic",
      asset: (p) => p,
    }),
  ).toThrow("完整序列帧画布不可用");
  expect(surface.gpu[0].releases).toBe(0);
  base.dispose();
  base.dispose();
  expect(surface.gpu[0].releases).toBe(1);
});

test("failed drawImage is not a committed cel and cannot retire fallback", async () => {
  const surface = browserSurfaces(),
    h = await setup(surface);
  await h.figure.preload();
  surface.paintThrows(true);
  expect(() => h.draw()).toThrow("actual whole paint failed");
  expect(surface.gpu[0].releases).toBe(0);
  surface.paintThrows(false);
  h.draw(0.01);
  expect(surface.gpu[0].releases).toBe(1);
  h.figure.dispose?.();
});

test("failed active DOM commit cannot retire base before visible activation succeeds", async () => {
  const h = await setup();
  await h.figure.preload();
  const native = HTMLCanvasElement.prototype.setAttribute;
  const setter = vi
    .spyOn(HTMLCanvasElement.prototype, "setAttribute")
    .mockImplementation(function (this: HTMLCanvasElement, name, value) {
      if (
        this.width === 100 &&
        this.height === 200 &&
        name === "data-pet-raster-active" &&
        value === "true"
      )
        throw new Error("activation failed");
      native.call(this, name, value);
    });
  expect(() => h.draw()).toThrow("activation failed");
  expect(h.surface.gpu[0].releases).toBe(0);
  setter.mockRestore();
  h.draw(0.01);
  expect(h.surface.gpu[0].releases).toBe(1);
  h.figure.dispose?.();
});

test("idempotent retire keeps metadata; explicit draw resumes with NEW same-scale context and accepted images", async () => {
  const h = await setup(),
    before = group();
  h.base.draw(before, { blush: 0 }, frame());
  const first = h.surface.gpu[0],
    vertices = first.vertices.slice(-4),
    requestCount = h.surface.requests.length;
  h.base.releaseRenderSurface();
  h.base.releaseRenderSurface();
  expect(before.querySelector("canvas")).toBeNull();
  expect(h.base.colors.z).toBe("#123456");
  h.base.pickupPoint();
  expect(h.surface.gpu).toHaveLength(1);
  const resumed = group();
  h.base.draw(resumed, { blush: 0 }, frame(0.01));
  const next = h.surface.gpu[1];
  expect(next.canvas).not.toBe(first.canvas);
  expect([next.canvas.width, next.canvas.height]).toEqual([300, 300]);
  expect(resumed.querySelector("canvas")).toBe(next.canvas);
  expect(h.surface.requests).toHaveLength(requestCount);
  expect(next.vertices.slice(-4)).toEqual(vertices);
  expect(next.uploads[0].source.src).toBe("tex/atlas.png");
  expect(
    h.surface.surfaces2D
      .at(-1)
      ?.paints.some((p) => p.source.src === "feat/eyes.png"),
  ).toBe(true);
  h.base.dispose();
  h.base.dispose();
  h.base.draw(resumed, { blush: 0 }, frame(1));
  expect(h.surface.gpu).toHaveLength(2);
  expect(h.surface.gpu.map((r) => r.releases)).toEqual([1, 1]);
});

test("retired scheme failure retains baseline; user retry updates metadata without GPU revival", async () => {
  const h = await setup();
  await h.commit();
  const uploads = h.surface.gpu[0].uploads.length;
  h.surface.broken.add("schemes/lab/tex/atlas.png");
  await expect(h.figure.setScheme("lab")).rejects.toThrow(
    "人物桌宠贴图无法加载",
  );
  expect(h.figure.scheme).toBe("classic");
  expect(h.base.scheme).toBe("classic");
  h.surface.broken.clear();
  await h.figure.setScheme("lab");
  expect(h.figure.scheme).toBe("lab");
  expect(h.base.colors.z).toBe("#234567");
  expect(
    h.surface.requests.filter((p) => p === "schemes/lab/tex/atlas.png"),
  ).toHaveLength(2);
  expect(h.surface.gpu).toHaveLength(1);
  expect(h.surface.gpu[0].uploads).toHaveLength(uploads);
  await h.base.setScheme("classic");
  await h.base.setScheme("lab");
  const fallback = group();
  h.base.draw(fallback, { blush: 0 }, frame(1));
  expect(h.surface.gpu).toHaveLength(2);
  expect(h.surface.gpu[1].uploads[0].source.src).toBe(
    "schemes/lab/tex/atlas.png",
  );
  h.figure.dispose?.();
});

test("scheme pending before commit completes after retire without old upload or revival", async () => {
  const h = await setup();
  h.draw();
  h.surface.paused.add("schemes/lab/");
  const pending = h.figure.setScheme("lab");
  await h.commit();
  // setScheme invalidates the previous idle decode before the new draw commits.
  await h.commit();
  expect(h.surface.gpu[0].releases).toBe(1);
  const uploads = h.surface.gpu[0].uploads.length;
  h.surface.complete("schemes/lab/");
  await pending;
  expect(h.figure.scheme).toBe("lab");
  h.draw(0.1);
  await settle();
  h.draw(0.2);
  expect(h.surface.gpu).toHaveLength(1);
  expect(h.surface.gpu[0].uploads).toHaveLength(uploads);
  expect(h.surface.requests).toContain("schemes/lab/tex/whole.png");
  h.figure.dispose?.();
});

test("retired late failure cannot replace newer success; dispose prevents pending work reviving surfaces", async () => {
  const h = await setup();
  await h.commit();
  h.surface.paused.add("schemes/lab/");
  const old = h.base.setScheme("lab"),
    rejected = expect(old).rejects.toThrow("人物桌宠贴图无法加载");
  await h.base.setScheme("maid");
  h.surface.broken.add("schemes/lab/tex/atlas.png");
  h.surface.complete("schemes/lab/");
  await rejected;
  expect(h.base.scheme).toBe("maid");
  h.surface.broken.clear();
  h.surface.paused.add("schemes/lab/");
  const later = h.base.setScheme("lab");
  h.figure.dispose?.();
  h.surface.complete("schemes/lab/");
  await later;
  h.base.draw(group(), { blush: 0 }, frame(2));
  expect(h.base.scheme).toBe("maid");
  expect(h.surface.gpu).toHaveLength(1);
  expect(h.surface.gpu[0].releases).toBe(1);
});

test("standalone standing/sitting/face and three outfits retain the original live surface", async () => {
  const surface = browserSurfaces(),
    base = await createHumanFigure({
      model,
      scheme: "classic",
      asset: (p) => p,
    }),
    target = group();
  base.draw(target, { blush: 0 }, frame());
  base.draw(target, { blush: 0 }, frame(0.1, "sit"));
  base.draw(target, { blush: 0 }, frame(0.2, "idle", "angry"));
  for (const id of ["lab", "maid", "classic"]) {
    await base.setScheme(id);
    base.draw(target, { blush: 0 }, frame(0.3));
  }
  expect(surface.gpu).toHaveLength(1);
  expect(surface.gpu[0].releases).toBe(0);
  expect([surface.gpu[0].canvas.width, surface.gpu[0].canvas.height]).toEqual([
    300, 300,
  ]);
  expect(
    surface.surfaces2D[0].paints.some(
      (p) => p.source.src === "feat/angry_eyes.png",
    ),
  ).toBe(true);
  expect(target.querySelector("canvas")).toBe(surface.gpu[0].canvas);
  base.dispose();
  expect(surface.gpu[0].releases).toBe(1);
});
